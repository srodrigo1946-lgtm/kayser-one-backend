import { Injectable, Logger } from "@nestjs/common";
import { ConversationsService } from "../conversations/conversations.service";
import { SettingsService } from "../settings/settings.service";
import { AiService } from "../ai/ai.service";
import { WhatsappService, pedeParar } from "./whatsapp.service";
import { LeadQueueService } from "../lead-queue/lead-queue.service";
import { UsersService } from "../users/users.service";
import { UserRole } from "../users/user.entity";
import { KnowledgeService } from "../knowledge/knowledge.service";

/**
 * O cliente mandou ÁUDIO → a resposta vira voz. Texto pra ser FALADO é diferente do
 * escrito: sem isso a voz lia listas, emojis e "R$ 308.000,00" como robô.
 */
const PROMPT_RESPOSTA_FALADA = `=== ESTA RESPOSTA VAI SER ENVIADA EM ÁUDIO (voz) ===
O cliente mandou áudio, então sua resposta será convertida em voz. Escreva como uma pessoa FALA num áudio de WhatsApp, em português do Brasil:
- Tom ANIMADO e humano, de corretor empolgado: comece com energia ("Opa, tudo bem?", "Olha só que legal!", "Show de bola!"), use exclamações nas boas notícias e expressões naturais ("olha", "então", "sabe?"). Nada de listas, tópicos, asteriscos ou emojis.
- Valores e números como se fala: "a partir de trezentos e oito mil reais", "entrega em dezembro de 2030", "de vinte e oito a setenta metros quadrados".
- No máximo 3 ou 4 frases (uns 20 segundos de áudio). Termine com UMA pergunta simples pra continuar a conversa.
- Se for mandar fotos, a linha [FOTOS: ...] continua valendo (ela não é falada).`;

/** Lead ainda sem e-mail no cadastro → a IA tem que pedir (regra do Rodrigo: SEMPRE pedir). */
const PROMPT_PEDIR_EMAIL = `=== E-MAIL DO CLIENTE: AINDA NÃO TEMOS ===
O cadastro deste cliente está SEM e-mail. Peça o e-mail dele de forma simpática (ex.: "me passa seu e-mail que eu te mando o material completo e as condições?").
- Se você NÃO pediu o e-mail nas suas 2 últimas mensagens, peça nesta.
- Se já pediu e ele não respondeu, continue a conversa e peça de novo mais pra frente, com outra frase (sem insistir em toda mensagem).
- Se ele disser que não quer passar, respeite e não peça mais.`;

/**
 * Cliente falando por áudio mas pediu a resposta ESCRITA ("manda por escrito",
 * "escreve o endereço", "digita aí")? Então essa resposta vai em texto, não em voz.
 */
export function pedeEscrito(texto: string): boolean {
  const t = (texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return /\b(escrev\w*|escrit[oa]s?|digit\w*|por texto|em texto|mensagem de texto|manda (o |a )?(endereco|link|localizacao)|me passa (o |a )?(endereco|link|localizacao)|nao (posso|consigo) (ouvir|escutar)|sem audio|nao manda audio)\b/.test(t);
}

/** Tag que a IA escreve para o sistema enviar as fotos: [FOTOS: Nome do empreendimento]. */
const TAG_FOTOS = /\[FOTOS:\s*([^\]]+)\]/gi;

/** Instrução dos empreendimentos (catálogo + como pedir fotos) — vale pra toda resposta da IA. */
function promptEmpreendimentos(catalogo: string): string {
  if (!catalogo.trim()) return "";
  return `=== EMPREENDIMENTOS DA EMPRESA (dados do cadastro) ===
${catalogo}

FOTOS: quando o cliente pedir fotos/imagens OU demonstrar interesse num empreendimento, você pode ENVIAR as fotos.
Para isso escreva, numa linha separada, exatamente: [FOTOS: Nome do empreendimento] (use o nome da lista acima).
O sistema tira essa linha do texto e envia as imagens logo depois da sua mensagem. Use no máximo uma vez por empreendimento na conversa.`;
}

/**
 * A IA escreve em Markdown (**negrito**, ### título, ---), mas o WhatsApp usa
 * *negrito* e não tem título/linha: sem isso o cliente via as estrelas e traços.
 */
export function paraWhatsapp(texto: string): string {
  return texto
    .replace(/\*\*(.+?)\*\*/g, "*$1*") // **negrito** → *negrito*
    .replace(/__(.+?)__/g, "_$1_")
    .replace(/^#{1,6}\s*(.+)$/gm, "*$1*") // ### Título → *Título*
    .replace(/^\s*(-{3,}|\*{3,}|_{3,})\s*$/gm, "") // linhas --- somem
    .replace(/^(\s*)[-*]\s+/gm, "$1• ") // lista com - ou * → •
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Instrução extra da IA quando atende lead de anúncio FORA do plantão. */
function promptForaDoPlantao(): string {
  const hoje = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return `=== ATENDIMENTO FORA DO PLANTÃO — VOCÊ É O KAYSER ===
Hoje é ${hoje} (horário de Brasília). Nenhum corretor está de plantão agora — VOCÊ atende este cliente.
- Seu nome é *Kayser*, o assistente de INTELIGÊNCIA ARTIFICIAL da equipe. Seja transparente: na sua PRIMEIRA resposta da conversa, apresente-se assim (adapte a saudação ao horário):
  "Olá! 👋 Eu sou o *Kayser*, assistente de inteligência artificial da equipe. Vou te ajudar agora e, em seguida, te transfiro para um dos nossos especialistas. 🏡"
  Nas respostas seguintes não precisa se apresentar de novo.
- Se o cliente mandou ÁUDIO, a mensagem aparece como 🎤 Áudio: "transcrição" — responda ao conteúdo normalmente.
- Formato WhatsApp: negrito com UMA estrela (*assim*), sem títulos (#), sem linhas "---", sem tabelas. Seja cordial e breve (mensagens curtas). Tire dúvidas SÓ com a base de conhecimento; se não souber, diga que o especialista vai responder.
- Qualifique com naturalidade (nome, empreendimento de interesse, renda, FGTS, entrada), sem interrogatório.
- Peça também o *nome* e o *e-mail* do cliente (ex.: "pra eu te enviar o material e a confirmação da visita"), uma coisa por vez.
- Seu objetivo principal é AGENDAR UMA VISITA: pergunte o melhor dia e horário para o cliente.
- Quando o cliente escolher dia E horário, confirme repetindo a data completa (ex.: "sábado, 28/09 às 10h") e diga que um especialista vai entrar em contato para confirmar.
- Se o cliente pedir para falar com uma pessoa, diga que já está transferindo e que um especialista vai falar com ele assim que o atendimento abrir.
- Não prometa preço/condição que não esteja na base de conhecimento.`;
}

@Injectable()
export class WhatsappFlowService {
  private readonly logger = new Logger(WhatsappFlowService.name);

  constructor(
    private readonly conversations: ConversationsService,
    private readonly settings: SettingsService,
    private readonly ai: AiService,
    private readonly whatsapp: WhatsappService,
    private readonly leadQueue: LeadQueueService,
    private readonly users: UsersService,
    private readonly knowledge: KnowledgeService
  ) {}

  /** Catálogo dos empreendimentos pro prompt (não derruba a resposta se falhar). */
  private async extraEmpreendimentos(leadId?: string | null): Promise<string> {
    const cat = await this.knowledge.catalogoEmpreendimentos().catch(() => "");
    const contexto = await this.knowledge.contextoDoLead(leadId).catch(() => "");
    return [promptEmpreendimentos(cat), contexto].filter(Boolean).join("\n\n");
  }

  /**
   * Envia a resposta da IA: em ÁUDIO (voz masculina) quando o cliente mandou áudio —
   * regra do Rodrigo —, senão em texto. Se a voz falhar, cai pro texto. Registra na conversa.
   */
  private async enviarResposta(
    convId: string,
    instanceName: string | undefined,
    remoteJidFull: string,
    reply: string,
    emAudio: boolean
  ) {
    if (emAudio && instanceName) {
      const voz = await this.ai.falarTexto(reply).catch(() => null);
      if (voz) {
        try {
          await this.whatsapp.sendAudio(instanceName, remoteJidFull, voz.base64);
          await this.conversations.addMessage(convId, `🔊 Áudio: "${reply}"`, "out", true, {
            mediaType: "audio",
            mediaMime: voz.mimetype,
            base64: voz.base64,
          });
          return;
        } catch (err) {
          this.logger.warn(`Falha ao enviar áudio, vai em texto: ${(err as Error).message}`);
        }
      }
    }
    await this.conversations.addMessage(convId, reply, "out", true);
    if (instanceName) {
      await this.whatsapp
        .sendText(instanceName, remoteJidFull, reply)
        .catch((err) => this.logger.warn(`Falha ao enviar via WhatsApp: ${(err as Error).message}`));
    }
  }

  /** Um relógio por conversa: a nota só sai quando a conversa "assenta". */
  private readonly timersScore = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Score do lead (0–100) pra TODA conversa — no plantão também, onde a IA não responde.
   * Espera 90s sem mensagem nova (o cliente costuma mandar várias seguidas) e aí a IA lê
   * as últimas 30 mensagens (cliente + corretor/Kayser) e dá a nota. Economiza chamadas.
   */
  private agendarScore(convId: string, leadId: string) {
    const antigo = this.timersScore.get(convId);
    if (antigo) clearTimeout(antigo);
    const t = setTimeout(async () => {
      this.timersScore.delete(convId);
      try {
        const hist = await this.conversations.getHistoryForAi(convId, 30);
        if (hist.length < 2) return;
        const texto = hist.map((m) => `${m.role === "user" ? "cliente" : "atendimento"}: ${m.content}`).join("\n");
        await this.ai.qualifyLead(leadId, texto);
      } catch (err) {
        this.logger.warn(`Não foi possível dar o score do lead: ${(err as Error).message}`);
      }
    }, 90_000);
    // Não segura o processo aberto (deploy/testes) só por causa do relógio.
    (t as any).unref?.();
    this.timersScore.set(convId, t);
  }

  /** Tira as tags [FOTOS: X] do texto e devolve os nomes pedidos. */
  private separarFotos(reply: string): { texto: string; pedidos: string[] } {
    const pedidos: string[] = [];
    const texto = reply.replace(TAG_FOTOS, (_m, nome: string) => {
      pedidos.push(nome.trim());
      return "";
    });
    return { texto: texto.replace(/\n{3,}/g, "\n\n").trim(), pedidos };
  }

  /** Envia as fotos dos empreendimentos pedidos pela IA (registra na conversa). */
  private async enviarFotos(convId: string, instanceName: string | undefined, remoteJidFull: string, pedidos: string[]) {
    if (!instanceName || !pedidos.length) return;
    for (const nome of [...new Set(pedidos)].slice(0, 2)) {
      const r = await this.knowledge.fotosDoEmpreendimento(nome).catch(() => null);
      if (!r?.fotos.length) {
        this.logger.warn(`IA pediu fotos de "${nome}", mas não há imagens cadastradas.`);
        continue;
      }
      for (const [i, f] of r.fotos.entries()) {
        const caption = i === 0 ? `📸 ${r.nome}` : undefined;
        try {
          await this.whatsapp.sendMedia(instanceName, remoteJidFull, { ...f, caption });
          await this.conversations.addMessage(convId, caption || `📷 ${r.nome}`, "out", true, {
            mediaType: "image",
            mediaMime: f.mimetype,
            base64: f.base64,
          });
        } catch (err) {
          this.logger.warn(`Falha ao enviar foto de ${r.nome}: ${(err as Error).message}`);
        }
      }
    }
  }

  /**
   * Processa um evento de mensagem recebida da Evolution API.
   * Persiste a mensagem e, se a resposta automática estiver ligada, gera e envia a resposta da IA.
   */
  async handleInbound(payload: any) {
    try {
      const parsed = this.parseEvolutionMessage(payload);
      if (!parsed) return { ignored: true };

      const { remoteJid, remoteJidFull, isGroup, text, mediaType, fromMe, pushName, instanceName, ad } = parsed;
      if (!text) return { ignored: true };

      // A instância se chama "user_<id>": é o dono do número que recebeu a mensagem.
      const receivingUserId = instanceName?.startsWith("user_")
        ? instanceName.slice("user_".length)
        : undefined;
      const conv = await this.conversations.findOrCreateByPhone(remoteJid, receivingUserId, isGroup);

      // Mensagem que o CARGO enviou pelo próprio celular (fromMe): registra no
      // histórico do atendimento e para por aqui — não gera IA, lead nem rodízio.
      // recordOutbound deduplica o eco das mensagens que o próprio CRM enviou.
      if (fromMe) {
        await this.conversations.recordOutbound(conv.id, text);
        return { persisted: true, fromMe: true };
      }

      // Contato marcado como "NÃO é lead" (pessoal): não gera lead/fila/IA. A
      // mensagem fica só no WhatsApp — nem registra no CRM (conversa já saiu de lá).
      if ((conv as any).naoLead) {
        return { persisted: false, naoLead: true };
      }

      // Baixa a mídia (imagem/áudio/vídeo/documento) para exibir no chat.
      let media: { mediaType: string; mediaMime: string; base64: string } | undefined;
      if (mediaType && mediaType !== "location" && mediaType !== "contact" && instanceName) {
        const rawMsg = Array.isArray(payload?.data) ? payload.data[0] : payload?.data ?? payload;
        const dl = await this.whatsapp.getMediaBase64(instanceName, rawMsg);
        if (dl) media = { mediaType, mediaMime: dl.mimetype, base64: dl.base64 };
      }
      const salva = await this.conversations.addMessage(conv.id, text, "in", false, media);

      // ÁUDIO do cliente: transcreve e grava o texto na conversa — assim a IA
      // (Kayser) responde a mensagem de voz e o corretor lê sem precisar ouvir.
      let audioTranscrito = false;
      let textoCliente = text; // o que o cliente disse (texto ou áudio transcrito)
      if (mediaType === "audio" && media?.base64 && !isGroup) {
        const t = await this.ai.transcreverAudio(media.base64, media.mediaMime).catch(() => null);
        if (t) {
          await this.conversations.updateMessageContent(salva.id, `🎤 Áudio: "${t}"`).catch(() => {});
          audioTranscrito = true;
          textoCliente = t;
        }
      }

      // Cliente mandou áudio → responde em voz; MAS se ele pediu por escrito, vai em texto.
      const responderEmAudio = audioTranscrito && !pedeEscrito(textoCliente);

      // Nome + foto do contato/grupo (busca a foto só quando ainda não temos).
      if (!isGroup) {
        // Individual: pushName é o nome do contato.
        let avatar = conv.contactAvatar;
        if (!avatar && instanceName) {
          avatar = await this.whatsapp.fetchProfilePicture(instanceName, remoteJid);
        }
        await this.conversations.setContactInfo(conv.id, pushName, avatar);
      } else if (instanceName && (!conv.contactName || !conv.contactAvatar)) {
        // Grupo: usa o nome (subject) e a foto do grupo.
        const info = await this.whatsapp.fetchGroupInfo(instanceName, remoteJidFull);
        await this.conversations.setContactInfo(conv.id, info.name, info.avatar);
      }

      // É o NÚMERO CENTRAL (Diretor)? Só ele gera lead/rodízio automático — e no
      // central a IA NÃO responde ninguém (quem atende é o humano/especialista).
      let ehCentral = false;
      if (!isGroup && receivingUserId) {
        const dono = await this.users.findOne(receivingUserId).catch(() => null);
        ehCentral = dono?.role === UserRole.DIRETOR;
      }

      // Anúncio "Clique para WhatsApp" NO NÚMERO CENTRAL: marca origem/campanha e,
      // se a fila estiver ligada, distribui em rodízio entre os cargos.
      if (ad && !isGroup && ehCentral) {
        // Log para diagnóstico: sem isto, um anúncio que chega num formato
        // inesperado não distribui e não deixa rastro nenhum.
        this.logger.log(
          `Lead de ANÚNCIO detectado (${ad.platform}${ad.campaign ? ` / ${ad.campaign}` : ""}) de ${remoteJid}.`
        );
        // Garante o Lead (cria se não existir) → cai no Kanban como Novo Lead.
        const adLeadId = await this.conversations.setAdOrigin(conv.id, ad.platform, ad.campaign, conv.leadId);
        conv.leadId = adLeadId ?? conv.leadId;
        // Qual empreendimento o anúncio divulga? Registra o lead nele ANTES do Kayser
        // responder — assim ele fala direto do imóvel certo, sem perguntar.
        await this.knowledge
          .vincularAoAnuncio(conv.leadId, ad.campaign, ad.texto, (a, o) => this.ai.escolherEmpreendimento(a, o))
          .then((nome) => nome && this.logger.log(`Anúncio "${ad.campaign}" → empreendimento ${nome}.`))
          .catch((err) => this.logger.warn(`Não identificou o empreendimento do anúncio: ${err?.message}`));
        conv.fromAd = true;
        const queue = await this.leadQueue.getSettings();
        if (queue.enabled) {
          const assignment = await this.leadQueue.enqueueLead({ conversationId: conv.id, leadId: conv.leadId ?? undefined });
          // Em plantão: avisa o cliente com o nome do especialista (corretor do rodízio).
          // Fora do plantão ("aguardando"): quem responde é a IA (abaixo), que atende e agenda visita.
          const foraDoPlantao = assignment?.status === "aguardando" && (await this.settings.get()).aiAutoReply;
          if (!foraDoPlantao) {
            await this.avisarEspecialista(conv, instanceName, remoteJidFull, assignment?.assignedToId);
          }
        }
      }

      // Lead do número central (anúncio): em plantão a IA NÃO responde — o especialista
      // humano assume. FORA do plantão (conversa aguardando o turno abrir), a IA atende,
      // qualifica e tenta agendar a visita; quando o turno abre, o corretor assume.
      // NÚMERO CENTRAL = só clientes (decisão do Rodrigo, 27/09/2026 — antes a IA não
      // respondia ninguém ali além de anúncio). Todo contato vira lead e entra na fila
      // como o anúncio: no plantão vai pro corretor; fora dele o Kayser atende.
      if (ehCentral && !conv.fromAd && !conv.leadId) {
        conv.leadId = (await this.conversations.criarLeadWhatsapp(conv.id)) ?? null;
      }

      // Cliente citou um empreendimento ("informações do Ilha Stay")? O lead fica
      // registrado nele — vale no plantão também (sem depender da IA responder).
      if (conv.leadId && !isGroup) {
        await this.knowledge.registrarInteresse(conv.leadId, textoCliente).catch(() => null);
        // Cliente mandou o e-mail? Vai direto pro cadastro do lead.
        await this.conversations.registrarEmailDoLead(conv.leadId, textoCliente).catch(() => null);
        // Pediu pra parar? Sai do follow-up automático (denúncia de spam derruba o número).
        if (pedeParar(textoCliente)) await this.conversations.marcarNaoPerturbe(conv.leadId).catch(() => null);
        // Score em TODA conversa com lead — no plantão também (a IA só lê, não responde).
        this.agendarScore(conv.id, conv.leadId);
      }

      if (ehCentral && !conv.fromAd) {
        const fila = await this.leadQueue.getSettings();
        if (fila.enabled && conv.leadId && !(await this.leadQueue.jaPassouNaFila(conv.id))) {
          const a = await this.leadQueue.enqueueLead({ conversationId: conv.id, leadId: conv.leadId });
          if (a && a.status !== "aguardando") {
            await this.avisarEspecialista(conv, instanceName, remoteJidFull, a.assignedToId);
            return { persisted: true, autoReply: false, central: true };
          }
        }
      }

      if (conv.fromAd || ehCentral) {
        // Mídia que não deu pra transcrever: a IA não "vê" — o humano responde.
        if (mediaType && !audioTranscrito) return { persisted: true, autoReply: false, central: true };
        // Alguém da equipe respondeu nas últimas 12h: o humano assumiu, Kayser não atropela.
        if (await this.conversations.humanoRespondeuRecente(conv.id, 12)) {
          return { persisted: true, autoReply: false, central: true };
        }
        // Com a fila ligada, o Kayser só atende quem está AGUARDANDO o plantão; se já
        // tem corretor (pendente/atendido), quem responde é ele.
        const fila = await this.leadQueue.getSettings();
        if (fila.enabled && !(await this.leadQueue.estaAguardando(conv.id))) {
          return { persisted: true, autoReply: false, central: true };
        }
        return this.responderForaDoPlantao(conv, instanceName, remoteJidFull, responderEmAudio);
      }

      // Mídia (imagem/áudio/etc.) é registrada, mas a IA não responde a ela (não "vê" o conteúdo).
      // (Áudio transcrito passa: a IA responde o texto da mensagem de voz.)
      if (mediaType && !audioTranscrito) return { persisted: true, autoReply: false, media: mediaType };

      const settings = await this.settings.get();
      if (!settings.aiAutoReply || settings.whatsappPausado) return { persisted: true, autoReply: false };

      // Mensagens de grupo só recebem resposta da IA se o toggle estiver ligado.
      if (isGroup && !settings.aiReplyGroups) {
        return { persisted: true, autoReply: false, group: true };
      }

      // Gera resposta da IA com base no histórico, usando a IA do cargo que atende
      // a conversa (ou a chave da empresa, se ele não tiver a própria).
      const history = await this.conversations.getHistoryForAi(conv.id);
      const userAi = await this.ai.getUserAiConfig(conv.assignedToId ?? undefined);
      let reply: string;
      try {
        const semEmail = conv.leadId ? !(await this.conversations.leadTemEmail(conv.leadId)) : false;
        const extra = [
          await this.extraEmpreendimentos(conv.leadId),
          semEmail ? PROMPT_PEDIR_EMAIL : "",
          responderEmAudio ? PROMPT_RESPOSTA_FALADA : "",
        ]
          .filter(Boolean)
          .join("\n\n");
        reply = paraWhatsapp(await this.ai.generateReply(history, userAi, extra));
      } catch (err) {
        this.logger.warn(`IA não respondeu (chave/config?): ${(err as Error).message}`);
        return { persisted: true, autoReply: false };
      }

      // A IA pode pedir fotos com [FOTOS: X]: tira a tag do texto e envia depois.
      const { texto: textoIa, pedidos: fotosPedidas } = this.separarFotos(reply);
      reply = textoIa;

      if (reply || fotosPedidas.length) {
        if (reply) await this.enviarResposta(conv.id, instanceName, remoteJidFull, reply, responderEmAudio);

        // Score do lead: agendado logo na entrada da mensagem (agendarScore).
        await this.enviarFotos(conv.id, instanceName, remoteJidFull, fotosPedidas);
      }
      return { persisted: true, autoReply: true };
    } catch (err) {
      this.logger.error("Erro no fluxo de entrada do WhatsApp", err as any);
      return { error: true };
    }
  }

  /**
   * IA atende o lead de anúncio FORA do plantão: responde, qualifica e, se o cliente
   * confirmou dia/horário, grava a visita na Agenda (vai pro corretor quando o turno abrir).
   */
  private async responderForaDoPlantao(
    conv: { id: string; leadId?: string | null },
    instanceName: string | undefined,
    remoteJidFull: string,
    clienteMandouAudio = false
  ) {
    const settings = await this.settings.get();
    if (!settings.aiAutoReply || settings.whatsappPausado) return { persisted: true, autoReply: false, central: true };

    const history = await this.conversations.getHistoryForAi(conv.id);
    const semEmail = conv.leadId ? !(await this.conversations.leadTemEmail(conv.leadId)) : false;
    let reply: string;
    try {
      reply = paraWhatsapp(
        await this.ai.generateReply(
          history,
          undefined,
          [
            promptForaDoPlantao(),
            await this.extraEmpreendimentos(conv.leadId),
            semEmail ? PROMPT_PEDIR_EMAIL : "",
            clienteMandouAudio ? PROMPT_RESPOSTA_FALADA : "",
          ]
            .filter(Boolean)
            .join("\n\n")
        )
      );
    } catch (err) {
      this.logger.warn(`IA (fora do plantão) não respondeu: ${(err as Error).message}`);
      return { persisted: true, autoReply: false, central: true };
    }
    // A IA pode pedir fotos com [FOTOS: X]: tira a tag do texto e envia depois.
    const { texto: textoIa, pedidos: fotosPedidas } = this.separarFotos(reply);
    reply = textoIa;
    if (!reply && !fotosPedidas.length) return { persisted: true, autoReply: false, central: true };

    if (reply) await this.enviarResposta(conv.id, instanceName, remoteJidFull, reply, clienteMandouAudio);
    await this.enviarFotos(conv.id, instanceName, remoteJidFull, fotosPedidas);

    // Em segundo plano: visita combinada → Agenda (o score é agendado na entrada). Falha em silêncio.
    if (conv.leadId) {
      const leadId = conv.leadId;
      const texto = [...history, { role: "assistant", content: reply }].map((m) => `${m.role}: ${m.content}`).join("\n");
      this.ai
        .extrairVisita(texto)
        .then(async (v) => {
          if (!v.confirmada || !v.dataHora) return;
          // dataHora vem no horário de Brasília (UTC-3, sem horário de verão).
          const quando = new Date(`${v.dataHora.slice(0, 16)}:00-03:00`);
          await this.leadQueue.agendarVisitaIA(leadId, quando, v.local);
        })
        .catch((err) => this.logger.warn(`Falha ao extrair visita: ${(err as Error).message}`));
    }
    return { persisted: true, autoReply: true, central: true, foraDoPlantao: true };
  }

  /**
   * Avisa o cliente (do número CENTRAL) que será atendido por um especialista — o
   * corretor do rodízio da fila — citando o nome. Fora de plantão (sem especialista
   * ainda) manda um aviso genérico. Essa é a ÚNICA resposta automática do central:
   * a IA não conversa com lead de anúncio. Registra a mensagem no histórico.
   */
  private async avisarEspecialista(
    conv: { id: string },
    instanceName: string | undefined,
    remoteJidFull: string,
    assignedToId?: string | null
  ) {
    let nome = "um especialista";
    if (assignedToId) {
      const esp = await this.users.findOne(assignedToId).catch(() => null);
      if (esp?.name) nome = esp.name.split(" ").slice(0, 2).join(" ");
    }
    const msg = assignedToId
      ? `Olá! 👋 Recebemos seu contato e você será atendido pelo nosso especialista *${nome}*, que já vai falar com você. 🏡`
      : `Olá! 👋 Recebemos seu contato. Em breve um dos nossos especialistas vai falar com você. 🏡`;
    try {
      await this.conversations.addMessage(conv.id, msg, "out", false);
      if (instanceName) await this.whatsapp.sendText(instanceName, remoteJidFull, msg);
    } catch (err) {
      this.logger.warn(`Falha ao avisar especialista: ${(err as Error).message}`);
    }
  }

  /**
   * Envio manual (cargo) que também registra na conversa. Responde SEMPRE pelo número
   * dono da conversa (`instanceOwnerId`) — importante quando é um lead da fila no número
   * central. Se for lead de anúncio, a resposta do cargo atribuído marca como atendido.
   */
  /** Pausa entre envios em massa (usada pelo follow-up). */
  pausaEntreDisparos() {
    return this.whatsapp.pausaEntreDisparos();
  }

  async sendManual(senderUserId: string, remoteJid: string, text: string) {
    const conv = await this.conversations.findOrCreateByPhone(remoteJid, senderUserId);
    // Sem dono de instância na conversa: sai pelo número CENTRAL (cargo não tem WhatsApp
    // conectado — antes caía em "user_<corretor>" e a mensagem falhava calada).
    const instanceOwner = conv.instanceOwnerId || (await this.conversations.diretorCentralId()) || senderUserId;
    await this.conversations.addMessage(conv.id, text, "out", false);
    // O que o corretor conversou também conta pro score (ex.: agendou visita).
    if (conv.leadId) this.agendarScore(conv.id, conv.leadId);
    if (conv.fromAd) {
      await this.leadQueue.markAttended(conv.id, senderUserId).catch(() => {});
    }
    return this.whatsapp.sendText(`user_${instanceOwner}`, remoteJid, text);
  }

  /**
   * Envio manual de ARQUIVO (imagem, PDF, Excel...) pelo cargo: registra na conversa
   * (a mídia vai pro R2/banco via addMessage) e envia pelo número dono da conversa.
   */
  async sendManualMedia(
    senderUserId: string,
    remoteJid: string,
    file: { base64: string; mimetype: string; fileName: string; caption?: string }
  ) {
    const conv = await this.conversations.findOrCreateByPhone(remoteJid, senderUserId);
    const instanceOwner = conv.instanceOwnerId || senderUserId;
    const ehImagem = file.mimetype.startsWith("image/");
    const rotulo = file.caption?.trim() || (ehImagem ? "📷 Imagem" : `📎 ${file.fileName}`);

    await this.conversations.addMessage(conv.id, rotulo, "out", false, {
      mediaType: ehImagem ? "image" : "document",
      mediaMime: file.mimetype,
      base64: file.base64,
    });
    if (conv.fromAd) {
      await this.leadQueue.markAttended(conv.id, senderUserId).catch(() => {});
    }
    return this.whatsapp.sendMedia(`user_${instanceOwner}`, remoteJid, file);
  }

  /**
   * Procura o referral do anúncio "Clique para WhatsApp" em qualquer nível do
   * payload. As chaves (`externalAdReply`, `entryPointConversionSource`) só
   * aparecem em mensagem de anúncio, então buscar em profundidade é seguro —
   * pega o referral onde quer que o Meta/Evolution o aninhe.
   */
  private findAdReferral(
    obj: any,
    depth = 0
  ): {
    externalAdReply?: any;
    entryPointConversionSource?: string;
    entryPointConversionApp?: string;
    ctwaPayload?: string;
  } | null {
    if (!obj || typeof obj !== "object" || depth > 6) return null;
    // Sinais EXCLUSIVOS de anúncio "Clique para WhatsApp" (Baileys/Meta variam o
    // lugar e às vezes só mandam um deles) — qualquer um já confirma que veio de ad.
    if (
      obj.externalAdReply !== undefined ||
      obj.entryPointConversionSource !== undefined ||
      obj.conversionSource !== undefined ||
      obj.ctwaClid !== undefined ||
      obj.conversionData !== undefined
    ) {
      return {
        externalAdReply: obj.externalAdReply,
        entryPointConversionSource: obj.entryPointConversionSource || obj.conversionSource,
        entryPointConversionApp: obj.entryPointConversionApp,
        ctwaPayload: obj.ctwaPayload || obj.ctwaClid,
      };
    }
    for (const k of Object.keys(obj)) {
      const found = this.findAdReferral(obj[k], depth + 1);
      if (found) return found;
    }
    return null;
  }

  /** Extrai os campos relevantes do payload da Evolution API (evento messages.upsert). */
  private parseEvolutionMessage(payload: any): {
    remoteJid: string;
    remoteJidFull: string;
    isGroup: boolean;
    text: string;
    mediaType: string | null;
    fromMe: boolean;
    pushName: string;
    instanceName?: string;
    ad?: { platform: "facebook" | "instagram" | "tiktok"; campaign?: string; texto?: string };
  } | null {
    const data = payload?.data ?? payload;
    const instanceName = payload?.instance || payload?.instanceName;
    const msg = Array.isArray(data) ? data[0] : data;
    if (!msg) return null;

    const key = msg.key ?? {};
    const remoteJidRaw: string = key.remoteJid || msg.remoteJid || "";
    if (!remoteJidRaw) return null;

    const message = msg.message ?? {};
    let text = message.conversation || message.extendedTextMessage?.text || "";
    let mediaType: string | null = null;

    // Anúncio "Clique para WhatsApp": o Meta manda o referral do anúncio no
    // payload, mas o LUGAR varia (contextInfo do extendedTextMessage, de uma
    // imageMessage, aninhado etc). Em vez de checar caminhos fixos, procuramos o
    // referral em QUALQUER profundidade — as chaves são exclusivas de anúncio,
    // então não há falso-positivo.
    const ref = this.findAdReferral(msg);
    let ad: { platform: "facebook" | "instagram" | "tiktok"; campaign?: string; texto?: string } | undefined;
    if (ref) {
      const ext = ref.externalAdReply || {};
      const hay = `${ref.entryPointConversionApp || ""} ${ext.sourceApp || ""} ${
        ext.sourceType || ""
      } ${ext.sourceUrl || ""}`.toLowerCase();
      const platform = hay.includes("insta") ? "instagram" : hay.includes("tiktok") ? "tiktok" : "facebook";
      ad = {
        platform,
        campaign: ext.title || ext.sourceId || ref.ctwaPayload || undefined,
        // Texto do anúncio (legenda/descrição): ajuda a saber de qual empreendimento é.
        texto: ext.body || ext.description || undefined,
      };
    } else {
      // Diagnóstico: mensagem NÃO reconhecida como anúncio. Loga só as CHAVES
      // (nunca o conteúdo) pra identificar formato novo. Nível `log` de propósito.
      this.logger.log(`Inbound sem anúncio. message=[${Object.keys(message).join(",")}]`);
    }

    // Mídia: quando não há texto, mostra um marcador para o atendente saber o que chegou.
    if (!text) {
      if (message.imageMessage) {
        mediaType = "image";
        text = message.imageMessage.caption || "📷 Imagem";
      } else if (message.audioMessage) {
        mediaType = "audio";
        text = message.audioMessage.ptt ? "🎤 Áudio (mensagem de voz)" : "🎵 Áudio";
      } else if (message.videoMessage) {
        mediaType = "video";
        text = message.videoMessage.caption || "🎥 Vídeo";
      } else if (message.documentMessage) {
        mediaType = "document";
        text = `📎 ${message.documentMessage.fileName || "Documento"}`;
      } else if (message.stickerMessage) {
        mediaType = "sticker";
        text = "🩹 Figurinha";
      } else if (message.locationMessage) {
        mediaType = "location";
        text = "📍 Localização";
      } else if (message.contactMessage || message.contactsArrayMessage) {
        mediaType = "contact";
        text = "👤 Contato compartilhado";
      }
    }

    return {
      remoteJid: remoteJidRaw.split("@")[0],
      remoteJidFull: remoteJidRaw,
      isGroup: remoteJidRaw.includes("@g.us"),
      text,
      mediaType,
      fromMe: !!key.fromMe,
      pushName: msg.pushName || "",
      instanceName,
      ad,
    };
  }
}
