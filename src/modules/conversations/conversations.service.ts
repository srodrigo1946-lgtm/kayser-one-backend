import { Injectable, NotFoundException, ForbiddenException } from "@nestjs/common";
import { telefoneBloqueado } from "../leads/bloqueio";
import { InjectRepository } from "@nestjs/typeorm";
import { In, IsNull, MoreThan, Repository } from "typeorm";
import { comCodigoBrasil, variantesDoTelefone } from "../../common/telefone";
import { Conversation } from "./conversation.entity";
import { Message, MessageDirection } from "./message.entity";
import { Lead, LeadStatus, LeadSource } from "../leads/lead.entity";
import { User, UserRole } from "../users/user.entity";
import { UsersService } from "../users/users.service";
import { LeadsService } from "../leads/leads.service";
import { AppointmentsService } from "../appointments/appointments.service";
import { AppointmentType } from "../appointments/appointment.entity";
import { StorageService } from "../storage/storage.service";

// Cada etiqueta do funil move o lead para a coluna correspondente do Kanban.
const ETIQUETA_STATUS: Record<string, LeadStatus> = {
  agendamento: LeadStatus.AGENDAMENTO,
  visita_realizada: LeadStatus.VISITA_REALIZADA,
  subida_pastas: LeadStatus.SUBIDA_PASTA,
  aprovacao: LeadStatus.APROVACAO,
  reprovacao: LeadStatus.REPROVACAO,
  venda_ganha: LeadStatus.VENDA_GANHA,
};

/**
 * Cliente que MANDA link do Facebook/Instagram (post, reels, anúncio) sai do Kayser One
 * (Rodrigo 09/11). Não confundir com o lead que CHEGA por anúncio "Clique pro WhatsApp"
 * (esse vem com adPreview e continua normal).
 */
export const LINK_ANUNCIO = /(?:facebook\.com|fb\.com|fb\.me|fb\.watch|instagram\.com|instagr\.am)\//i;
const LINK_ANUNCIO_SQL = "(facebook\\.com|fb\\.com|fb\\.me|fb\\.watch|instagram\\.com|instagr\\.am)/";

/**
 * Palavrão / mensagem agressiva do cliente: também sai do Kayser One (Rodrigo 09/11).
 * Compara sem acento e em minúsculo. "Não" sozinho NÃO conta (isso é o fluxo de sem interesse).
 */
const OFENSA = new RegExp(
  "\\b(" +
    [
      "porra", "caralho", "krl", "puta", "puto", "putaria", "merda", "bosta", "foda", "fodase", "foda-se", "foder", "fudeu",
      "fdp", "vsf", "vtnc", "tnc", "pqp", "arrombad[oa]s?", "desgracad[oa]s?", "cuzao", "corno", "babaca", "otari[oa]s?",
      "idiota", "imbecil", "lixo", "vagabund[oa]s?", "safad[oa]s?", "golpe", "golpista", "golpistas",
      "filh[oa] da puta", "vai se (ferrar|fuder|foder|lascar)", "vai tomar no", "enfia",
      "(para|pare|parem) de (me )?(mandar|encher|perturbar|ligar)", "nao me (mande|manda|mandem) mais",
      "vou (te )?denunciar", "spam",
    ].join("|") +
    ")\\b",
  "i"
);
// Raízes sem acento pro pré-filtro no banco (a regra de verdade é temOfensa).
const OFENSA_PREFILTRO_SQL =
  "(porra|caralho|krl|puta|puto|merda|bosta|fod|fud|fdp|vsf|vtnc|tnc|pqp|arrombad|desgra|cuz|corno|babaca|ot.ri|idiota|imbecil|lixo|vagabund|safad|golp|enfia|denunciar|spam|par[ae]m? de|me mand)";
export function temOfensa(texto: string): boolean {
  const t = (texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return OFENSA.test(t);
}

// Quem já está negociando não sai sozinho por causa de um link.
export const NEGOCIANDO: LeadStatus[] = [
  LeadStatus.AGENDAMENTO, LeadStatus.VISITA_AGENDADA, LeadStatus.VISITA_REALIZADA, LeadStatus.DOCUMENTACAO,
  LeadStatus.SIMULACAO, LeadStatus.SUBIDA_PASTA, LeadStatus.APROVACAO, LeadStatus.REPROVACAO, LeadStatus.VENDA_GANHA,
];

/**
 * E-mail FALADO no áudio vira e-mail escrito: "rodrigo ponto silva arroba gmail ponto com"
 * → "rodrigo.silva@gmail.com". Só mexe no trecho em volta de "arroba".
 */
function emailFalado(texto: string): string {
  return texto.replace(
    /([a-z0-9_-]+(?:\s+(?:ponto|underline|traço|traco|hífen|hifen)\s+[a-z0-9_-]+)*)\s+arroba\s+([a-z0-9-]+(?:\s+ponto\s+[a-z0-9-]+)+)/gi,
    (_m, antes: string, depois: string) => {
      const junta = (s: string) =>
        s
          .replace(/\s+ponto\s+/gi, ".")
          .replace(/\s+underline\s+/gi, "_")
          .replace(/\s+(traço|traco|hífen|hifen)\s+/gi, "-");
      return `${junta(antes)}@${junta(depois)}`;
    }
  );
}

/** Primeiro e-mail válido do texto (minúsculo), ou null. Entende e-mail falado em áudio. */
export function extrairEmail(texto: string): string | null {
  const t = emailFalado(texto || "");
  const m = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.exec(t);
  return m ? m[0].toLowerCase().replace(/\.+$/, "") : null;
}

/**
 * Aviso de passagem da fila ("Você agora será atendido pelo nosso especialista X").
 * Os cargos NÃO veem (mostraria por quais corretores o lead já passou) — só o Diretor.
 */
export function ehAvisoDaFila(texto?: string | null): boolean {
  return /agora ser[aá] atendid[oa] pelo nosso especialista/i.test(texto || "");
}

@Injectable()
export class ConversationsService {
  constructor(
    @InjectRepository(Conversation)
    private readonly convRepo: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly msgRepo: Repository<Message>,
    @InjectRepository(Lead)
    private readonly leadsRepo: Repository<Lead>,
    private readonly users: UsersService,
    private readonly leads: LeadsService,
    private readonly appointments: AppointmentsService,
    private readonly storage: StorageService
  ) {}

  /** Lista conversas respeitando a hierarquia (cada gestor vê apenas as da sua equipe). */
  /**
   * Sinal LEVE para o alerta sonoro: só quantas conversas existem no escopo do
   * usuário. Se esse número sobe, é contato novo no WhatsApp (lead orgânico
   * chegando). Evita baixar a lista inteira a cada consulta.
   */
  async contarConversas(user: User) {
    const qb = this.convRepo.createQueryBuilder("c").leftJoin("c.lead", "lead");
    const scopeIds = await this.users.getScopeIds(user);
    if (scopeIds !== null) {
      qb.where("(c.assignedToId IN (:...ids) OR lead.responsavelId IN (:...ids))", { ids: scopeIds });
    }
    return { total: await qb.getCount() };
  }

  async list(user: User) {
    const qb = this.convRepo
      .createQueryBuilder("c")
      .leftJoinAndSelect("c.lead", "lead")
      // Só os campos do atendente que interessam ao front (sem passwordHash).
      .leftJoin("c.assignedTo", "atendente")
      .addSelect(["atendente.id", "atendente.name", "atendente.role", "atendente.avatar"])
      // NULLS LAST: conversa sem mensagem (~500) subia pro topo e escondia as ativas.
      .orderBy("c.lastMessageAt", "DESC", "NULLS LAST")
      // SÓ conversas de LEAD entram no K1. Conversa pessoal e grupo (que
      // nunca têm lead vinculado) ficam de fora — o WhatsApp da pessoa não vira CRM.
      .where("c.leadId IS NOT NULL");

    // Visibilidade por hierarquia (igual ao resto do sistema): o Diretor vê TODAS
    // as conversas (de lead); cada gerente vê as da sua equipe (árvore de
    // descendentes); o corretor vê só as suas. O escopo casa tanto pelo atendente
    // da conversa quanto pelo responsável do lead.
    const scopeIds = await this.users.getScopeIds(user);
    if (scopeIds !== null) {
      qb.andWhere("(c.assignedToId IN (:...ids) OR lead.responsavelId IN (:...ids))", {
        ids: scopeIds,
      });
    }
    const convs = await qb.getMany();
    if (user.role !== UserRole.DIRETOR) {
      // A prévia da lista também não pode mostrar o aviso da fila pros cargos.
      for (const c of convs) if (ehAvisoDaFila(c.lastMessage)) (c as any).lastMessage = "";
    }
    return convs;
  }

  /**
   * Escopo de GESTÃO da conversa (igual ao list): Diretor tudo; demais só a sua
   * equipe. Impede mexer (atribuir/etiquetar) em conversa fora do escopo por id.
   */
  /** Envio manual (/whatsapp/send): só em conversa do próprio time (auditoria 19/10). */
  assertPodeEnviar(conv: Conversation, user: User) {
    return this.assertConvScope(conv, user);
  }

  private async assertConvScope(conv: Conversation, user: User) {
    const scopeIds = await this.users.getScopeIds(user);
    if (scopeIds === null) return; // Diretor
    const ownerId = conv.assignedToId ?? undefined;
    const leadRespId = (conv.lead as Lead | undefined)?.responsavelId ?? undefined;
    const ok = (!!ownerId && scopeIds.includes(ownerId)) || (!!leadRespId && scopeIds.includes(leadRespId));
    if (!ok) throw new ForbiddenException("Você não tem acesso a esta conversa.");
  }

  /** Atribui (ou remove) o atendente responsável por uma conversa. */
  async assign(conversationId: string, userId: string | null, requester: User) {
    const conv = await this.convRepo.findOne({ where: { id: conversationId }, relations: ["lead"] });
    if (!conv) throw new NotFoundException("Conversa não encontrada.");
    await this.assertConvScope(conv, requester); // não deixa mexer em conversa fora do escopo
    if (userId) {
      const scopeIds = await this.users.getScopeIds(requester);
      if (scopeIds !== null && !scopeIds.includes(userId)) {
        throw new ForbiddenException("Você só pode atribuir a conversa a alguém da sua equipe.");
      }
    }
    conv.assignedToId = userId ?? null;
    await this.convRepo.save(conv);

    // Sincroniza o responsável do lead vinculado (transferir a conversa move o
    // lead junto). Escreve direto no repo do lead — não chama LeadsService.update,
    // então não há loop.
    if (conv.leadId) {
      await this.leadsRepo.update(conv.leadId, { responsavelId: userId ?? null });
    }

    return this.stripAssigned(
      await this.convRepo.findOne({ where: { id: conversationId }, relations: ["lead", "assignedTo"] })
    );
  }

  /**
   * Marca a conversa como "NÃO é lead" (contato pessoal): remove o lead do CRM,
   * desvincula e sinaliza pra que futuras mensagens desse número NÃO virem lead.
   */
  async marcarNaoLead(conversationId: string, requester: User) {
    const conv = await this.convRepo.findOne({ where: { id: conversationId } });
    if (!conv) throw new NotFoundException("Conversa não encontrada.");
    await this.assertConvScope(conv, requester);
    await this.tirarDoCrm(conv);
    return { ok: true };
  }

  /** Núcleo do "não é lead": desvincula, marca e apaga o lead do CRM. */
  private async tirarDoCrm(conv: Conversation) {
    const leadId = conv.leadId;
    await this.convRepo.update(conv.id, { naoLead: true, leadId: null as any, assignedToId: null as any });
    // Tira o lead do CRM (Leads/Kanban). Best-effort: se travar FK, a conversa já
    // ficou desvinculada e fora das listas.
    if (leadId) await this.leadsRepo.delete({ id: leadId }).catch(() => {});
  }

  /**
   * Mensagem do cliente com link de Facebook/Instagram: tira do Kayser One (igual "não é lead"),
   * a não ser que o lead já esteja negociando (agendamento em diante). Devolve true se tirou.
   */
  async removerSeLinkAnuncio(conv: Conversation, texto: string): Promise<boolean> {
    if (!(LINK_ANUNCIO.test(texto || "") || temOfensa(texto)) || conv.isGroup || conv.naoLead) return false;
    if (conv.leadId) {
      const lead = await this.leadsRepo.findOne({ where: { id: conv.leadId }, select: ["id", "status"] });
      if (lead && NEGOCIANDO.includes(lead.status as LeadStatus)) return false;
    }
    await this.tirarDoCrm(conv);
    return true;
  }

  /**
   * Limpeza dos que JÁ mandaram link de Facebook/Instagram (mesma regra). confirmar=false
   * só lista (pra conferir antes); confirmar=true tira do CRM.
   */
  async limparLinksAnuncio(confirmar: boolean) {
    // Pré-filtro no banco (link OU raiz de palavrão); a regra completa confere em seguida.
    const candidatos: { id: string; leadId: string | null; nome: string | null; status: string | null; responsavel: string | null; content: string }[] =
      await this.convRepo.query(
        `SELECT c.id, c."leadId", COALESCE(l.name, c."contactName") AS nome, l.status, u.name AS responsavel, m.content
           FROM conversations c
           JOIN messages m ON m."conversationId" = c.id AND m.direction = 'in' AND m."adPreview" IS NULL
           LEFT JOIN leads l ON l.id = c."leadId"
           LEFT JOIN users u ON u.id = l."responsavelId"
          WHERE c."naoLead" = false AND c."isGroup" = false
            AND (m.content ~* $1 OR m.content ~* $3)
            AND (l.status IS NULL OR l.status <> ALL($2))`,
        [LINK_ANUNCIO_SQL, NEGOCIANDO, OFENSA_PREFILTRO_SQL]
      );
    const vistos = new Map<string, (typeof candidatos)[number] & { motivo: string }>();
    for (const c of candidatos) {
      if (vistos.has(c.id)) continue;
      const motivo = LINK_ANUNCIO.test(c.content) ? "link" : temOfensa(c.content) ? "ofensa" : null;
      if (motivo) vistos.set(c.id, { ...c, motivo, content: c.content.slice(0, 120) });
    }
    const rows = [...vistos.values()];
    if (confirmar) {
      for (const r of rows) await this.tirarDoCrm({ id: r.id, leadId: r.leadId } as Conversation);
    }
    return { total: rows.length, removidos: confirmar ? rows.length : 0, itens: rows.slice(0, 300) };
  }

  /**
   * Define as etiquetas da conversa e integra com Kanban/Agenda:
   * cada etiqueta recém-adicionada move o lead para a coluna correspondente do
   * Kanban; "agendamento" também cria um compromisso na Agenda.
   */
  async setEtiquetas(conversationId: string, etiquetas: string[], requester: User) {
    const conv = await this.convRepo.findOne({ where: { id: conversationId }, relations: ["lead"] });
    if (!conv) throw new NotFoundException("Conversa não encontrada.");
    await this.assertConvScope(conv, requester); // não deixa etiquetar conversa fora do escopo

    const antigas = conv.etiquetas ?? [];
    const novas = Array.isArray(etiquetas) ? etiquetas : [];
    const adicionadas = novas.filter((e) => !antigas.includes(e));

    conv.etiquetas = novas;
    await this.convRepo.save(conv);

    // Toda etiqueta é uma coluna do Kanban → sempre implica movimento.
    // Se ainda não há lead vinculado, cria a partir do número (para o card aparecer/mover).
    // Grupo NUNCA vira lead, nem quando etiquetado por engano.
    const precisaLead = adicionadas.length > 0 && !conv.isGroup;
    if (precisaLead && !conv.leadId) {
      const numero = conv.remoteJid ?? "";
      try {
        const lead = await this.leads.create(
          {
            name: conv.contactName || numero || "Contato WhatsApp",
            phone: numero,
            whatsapp: numero,
            // Sem isso a coluna Origem ficava vazia para quem chega direto no
            // WhatsApp — e não dava pra distinguir de lead sem procedência.
            origem: conv.fromAd ? "anuncio" : "whatsapp",
            responsavelId: conv.assignedToId ?? undefined,
          } as any,
          requester,
          // Conversa de anúncio → lead de anúncio; senão, chegou sozinho no WhatsApp.
          conv.fromAd ? LeadSource.ANUNCIO : LeadSource.WHATSAPP
        );
        conv.leadId = lead.id;
        conv.lead = lead;
        await this.convRepo.save(conv);
      } catch {
        /* segue mesmo se não conseguir criar o lead */
      }
    }

    for (const et of adicionadas) {
      // A etiqueta É a coluna do Kanban (key = status). Move o card direto para ela.
      // ETIQUETA_STATUS mantém compatibilidade com chaves antigas.
      const status = ETIQUETA_STATUS[et] ?? et;
      if (status && conv.leadId) {
        try {
          await this.leads.updateStatus(conv.leadId, status, undefined, requester);
        } catch {
          /* não bloqueia a etiqueta se o kanban falhar */
        }
      }
      // Agendamento cria um compromisso na Agenda.
      if (et === "agendamento") {
        // Amanhã às 10h de Brasília (13h UTC) — o servidor roda em UTC e caía às 07h.
        const quando = new Date(Date.now() - 3 * 3_600_000 + 86_400_000); // dia de amanhã em Brasília
        quando.setUTCHours(13, 0, 0, 0);
        try {
          await this.appointments.create(
            {
              title: `Agendamento — ${conv.lead?.name ?? conv.remoteJid ?? "Contato"}`,
              type: AppointmentType.VISITA,
              scheduledAt: quando,
              leadId: conv.leadId,
              userId: conv.assignedToId ?? conv.lead?.responsavelId ?? requester.id,
            },
            requester
          );
        } catch {
          /* não bloqueia a etiqueta se a agenda falhar */
        }
      }
    }

    return this.stripAssigned(
      await this.convRepo.findOne({ where: { id: conversationId }, relations: ["lead", "assignedTo"] })
    );
  }

  /** Remove o passwordHash do atendente vinculado, se houver. */
  private stripAssigned(conv: Conversation | null) {
    if (conv?.assignedTo) delete (conv.assignedTo as any).passwordHash;
    return conv;
  }

  async getMessages(conversationId: string, user: User) {
    const conv = await this.convRepo.findOne({ where: { id: conversationId }, relations: ["lead", "assignedTo"] });
    if (!conv) throw new NotFoundException("Conversa não encontrada.");
    await this.assertConvScope(conv, user); // visibilidade por hierarquia (igual ao list)
    this.stripAssigned(conv);
    const todas = await this.msgRepo.find({
      where: { conversationId },
      order: { createdAt: "ASC" },
    });
    // Cargos veem a conversa (cliente + Kayser + corretor), sem os avisos da fila.
    const rows = user.role === UserRole.DIRETOR ? todas : todas.filter((m) => !ehAvisoDaFila(m.content));
    // Não envia o mediaKey (pode ser um data URI enorme); expõe só se há mídia.
    const messages = rows.map((m) => {
      const { mediaKey, ...rest } = m;
      return { ...rest, hasMedia: !!mediaKey };
    });
    // Marca como lida
    if (conv.unreadCount > 0) {
      conv.unreadCount = 0;
      await this.convRepo.save(conv);
    }
    return { conversation: conv, messages };
  }

  /**
   * Encontra (ou cria) a conversa pelo número remoto, vinculando a um lead quando possível.
   * `receivingUserId` é o dono da instância que recebeu (cada cargo tem o seu WhatsApp):
   * quando não há responsável de lead, a conversa nasce atribuída a ele.
   */
  async findOrCreateByPhone(
    remoteJid: string,
    receivingUserId?: string,
    isGroup = false
  ): Promise<Conversation> {
    // Com ou sem o 55 é o mesmo cliente: acha a conversa em qualquer formato (senão a resposta
    // dele abriria outra conversa e outro lead). Conversa nova já nasce com o 55.
    const phone = isGroup ? remoteJid.replace(/\D/g, "") : comCodigoBrasil(remoteJid);
    let conv = await this.convRepo.findOne({ where: { remoteJid: In(isGroup ? [phone] : variantesDoTelefone(phone)) }, relations: ["lead"] });
    if (conv) {
      let changed = false;
      if (isGroup && !conv.isGroup) {
        conv.isGroup = true;
        changed = true;
      }
      // Se ainda não tem dono e sabemos quem recebeu, assume o dono do número.
      if (!conv.assignedToId && receivingUserId) {
        conv.assignedToId = receivingUserId;
        changed = true;
      }
      // Registra qual número/instância recebe esta conversa (para responder pelo certo).
      if (!conv.instanceOwnerId && receivingUserId) {
        conv.instanceOwnerId = receivingUserId;
        changed = true;
      }
      if (changed) await this.convRepo.save(conv);
      return conv;
    }

    // Tenta vincular a um lead existente pelo telefone/whatsapp
    const lead = await this.leadsRepo
      .createQueryBuilder("lead")
      .where("regexp_replace(lead.phone, '[^0-9]', '', 'g') LIKE :p", { p: `%${phone.slice(-8)}%` })
      .orWhere("regexp_replace(coalesce(lead.whatsapp,''), '[^0-9]', '', 'g') LIKE :p", { p: `%${phone.slice(-8)}%` })
      .getOne();

    // Nasce atribuída ao responsável do lead; sem lead, ao dono do número que recebeu.
    // Isso define a visibilidade por equipe (cada cargo vê as conversas do seu WhatsApp).
    conv = this.convRepo.create({
      remoteJid: phone,
      isGroup,
      leadId: lead?.id,
      assignedToId: lead?.responsavelId ?? receivingUserId,
      instanceOwnerId: receivingUserId,
    });
    return this.convRepo.save(conv);
  }

  /**
   * Marca a conversa como originada de anúncio e GARANTE um Lead. Se já existe lead,
   * atualiza origem/campanha; se não, CRIA um Lead automaticamente (preenchido com o
   * número/nome do contato) — ele nasce com status "Novo Lead" e cai no Kanban.
   * Devolve o id do lead (novo ou existente).
   */
  async setAdOrigin(
    conversationId: string,
    platform: string,
    campaign?: string,
    leadId?: string
  ): Promise<string | undefined> {
    await this.convRepo.update(conversationId, { fromAd: true });
    if (leadId) {
      // O título do anúncio é a única pista de empreendimento que o Meta manda.
      // NUNCA sobrescrever o que o corretor já preencheu — só completar o vazio.
      const atual = await this.leadsRepo.findOne({ where: { id: leadId } });
      await this.leadsRepo.update(leadId, {
        origem: platform,
        campanha: campaign ?? null,
        source: LeadSource.ANUNCIO,
        ...(campaign && !atual?.empreendimento ? { empreendimento: campaign } : {}),
      });
      return leadId;
    }
    // Sem lead ainda: cria um automaticamente a partir da conversa.
    const conv = await this.convRepo.findOne({ where: { id: conversationId } });
    if (!conv) return undefined;
    const numero = (conv.remoteJid ?? "").replace(/\D/g, "");
    try {
      const lead = this.leadsRepo.create({
        name: conv.contactName || numero || "Contato WhatsApp",
        phone: numero,
        whatsapp: numero,
        origem: platform,
        campanha: campaign ?? undefined,
        empreendimento: campaign ?? undefined, // título do anúncio
        source: LeadSource.ANUNCIO,
        responsavelId: conv.assignedToId ?? undefined,
        // status usa o default da entidade = Novo Lead
      });
      const saved = await this.leadsRepo.save(lead);
      conv.leadId = saved.id;
      await this.convRepo.save(conv);
      return saved.id;
    } catch {
      return undefined; // não quebra o inbound se a criação do lead falhar
    }
  }

  /**
   * Contato que chegou SEM anúncio no número central (orgânico): cria o lead com
   * origem WhatsApp → cai no Kanban como Novo Lead. Devolve o id (ou undefined).
   */
  async criarLeadWhatsapp(conversationId: string): Promise<string | undefined> {
    const conv = await this.convRepo.findOne({ where: { id: conversationId } });
    if (!conv) return undefined;
    if (conv.leadId) return conv.leadId;
    const numero = (conv.remoteJid ?? "").replace(/\D/g, "");
    // Lead excluído pelo Diretor não volta a virar lead pelo WhatsApp.
    if (await telefoneBloqueado(this.leadsRepo.manager, numero)) return undefined;
    try {
      const saved = await this.leadsRepo.save(
        this.leadsRepo.create({
          name: conv.contactName || numero || "Contato WhatsApp",
          phone: numero,
          whatsapp: numero,
          origem: "whatsapp",
          source: LeadSource.WHATSAPP,
          responsavelId: conv.assignedToId ?? undefined,
        })
      );
      await this.convRepo.update(conv.id, { leadId: saved.id });
      return saved.id;
    } catch {
      return undefined; // não quebra o inbound se a criação do lead falhar
    }
  }

  /**
   * Se o texto do cliente tem um e-mail, grava no lead (só se ainda estiver vazio —
   * não sobrescreve o que o corretor cadastrou). Devolve o e-mail gravado ou null.
   */
  async registrarEmailDoLead(leadId: string, texto: string): Promise<string | null> {
    const email = extrairEmail(texto);
    if (!email) return null;
    const lead = await this.leadsRepo.findOne({ where: { id: leadId } });
    if (!lead || lead.email) return null;
    await this.leadsRepo.update(leadId, { email });
    return email;
  }

  private centralCache: { id: string | null; em: number } | null = null;

  /** Diretor dono do número CENTRAL (os cargos não têm WhatsApp próprio conectado). */
  async diretorCentralId(): Promise<string | null> {
    if (this.centralCache && Date.now() - this.centralCache.em < 5 * 60_000) return this.centralCache.id;
    const d = await this.leadsRepo.manager
      .getRepository(User)
      .findOne({ where: { role: UserRole.DIRETOR, empresaId: IsNull() }, order: { createdAt: "ASC" } })
      .catch(() => null);
    this.centralCache = { id: d?.id ?? null, em: Date.now() };
    return this.centralCache.id;
  }

  /** Fixa o número (instância) que fala com esta conversa. */
  async definirInstancia(conversationId: string, ownerId: string) {
    await this.convRepo.update(conversationId, { instanceOwnerId: ownerId });
  }

  /** Cliente pediu pra parar: marca o lead (sai do follow-up automático). */
  async marcarNaoPerturbe(leadId: string) {
    await this.leadsRepo.update(leadId, { naoPerturbe: true });
  }

  /** O lead já tem e-mail no cadastro? (a IA pede enquanto não tiver) */
  async leadTemEmail(leadId: string): Promise<boolean> {
    const lead = await this.leadsRepo.findOne({ where: { id: leadId }, select: ["id", "email"] });
    return !!lead?.email;
  }

  /** Alguém da EQUIPE (não a IA) mandou mensagem nesta conversa nas últimas `horas`? */
  async humanoRespondeuRecente(conversationId: string, horas: number): Promise<boolean> {
    const desde = new Date(Date.now() - horas * 3_600_000);
    const n = await this.msgRepo.count({
      where: { conversationId, direction: "out", isAI: false, createdAt: MoreThan(desde) },
    });
    return n > 0;
  }

  /** Vincula um lead à conversa (usado pela entrada de formulário Meta). */
  async setLead(conversationId: string, leadId: string, contactName?: string) {
    await this.convRepo.update(conversationId, {
      leadId,
      ...(contactName ? { contactName } : {}),
    });
  }

  /** Atualiza nome (pushName) e/ou foto de perfil do contato, se mudaram. */
  async setContactInfo(conversationId: string, name?: string | null, avatar?: string | null) {
    const conv = await this.convRepo.findOne({ where: { id: conversationId } });
    if (!conv) return;
    let changed = false;
    if (name && conv.contactName !== name) {
      conv.contactName = name;
      changed = true;
    }
    if (avatar && conv.contactAvatar !== avatar) {
      conv.contactAvatar = avatar;
      changed = true;
    }
    if (changed) await this.convRepo.save(conv);
  }

  /**
   * Registra uma mensagem de SAÍDA que o cargo enviou pelo PRÓPRIO CELULAR
   * (evento `fromMe` do webhook) — sem isso o histórico do atendimento fica
   * incompleto (só aparece o que foi enviado pelo CRM). Deduplica o ECO: quando
   * o próprio CRM envia, a Evolution devolve a mesma mensagem como `fromMe`; se
   * já existe uma saída idêntica nos últimos 20s, ignora para não duplicar.
   */
  async recordOutbound(conversationId: string, content: string): Promise<Message | null> {
    const since = new Date(Date.now() - 20_000);
    const eco = await this.msgRepo.findOne({
      where: { conversationId, direction: "out", content, createdAt: MoreThan(since) },
    });
    if (eco) return null;
    return this.addMessage(conversationId, content, "out", false);
  }

  /** Troca o texto de uma mensagem (ex.: "🎤 Áudio" → transcrição) e a prévia da conversa. */
  async updateMessageContent(messageId: string, content: string) {
    const msg = await this.msgRepo.findOne({ where: { id: messageId } });
    if (!msg) return;
    await this.msgRepo.update(messageId, { content });
    const conv = await this.convRepo.findOne({ where: { id: msg.conversationId } });
    if (conv && conv.lastMessageAt && new Date(conv.lastMessageAt).getTime() === new Date(msg.createdAt).getTime()) {
      await this.convRepo.update(conv.id, { lastMessage: content });
    }
  }

  async addMessage(
    conversationId: string,
    content: string,
    direction: MessageDirection,
    isAI = false,
    media?: { mediaType?: string; mediaMime?: string; base64?: string; adPreview?: string }
  ): Promise<Message> {
    // Guarda a mídia (imagem/áudio/etc.): R2 quando configurado, senão data URI no banco.
    let mediaKey: string | undefined;
    if (media?.base64) {
      const mime = media.mediaMime || "application/octet-stream";
      if (this.storage.isEnabled) {
        const ext = (mime.split("/")[1] || "bin").split(";")[0];
        const key = `whatsapp/${conversationId}/${Date.now()}.${ext}`;
        const stored = await this.storage.upload(key, Buffer.from(media.base64, "base64"), mime);
        mediaKey = stored || `data:${mime};base64,${media.base64}`;
      } else {
        mediaKey = `data:${mime};base64,${media.base64}`;
      }
    }
    const msg = this.msgRepo.create({
      conversationId,
      content,
      direction,
      isAI,
      mediaType: media?.mediaType,
      mediaMime: media?.mediaMime,
      mediaKey,
      adPreview: media?.adPreview ?? null,
    });
    const saved = await this.msgRepo.save(msg);

    const conv = await this.convRepo.findOne({ where: { id: conversationId } });
    if (conv) {
      conv.lastMessage = content;
      conv.lastMessageAt = saved.createdAt;
      if (direction === "in") conv.unreadCount += 1;
      await this.convRepo.save(conv);

      // Atualiza o último contato do lead vinculado
      if (conv.leadId) {
        await this.leadsRepo.update(conv.leadId, { lastContactAt: saved.createdAt });
      }
    }
    return saved;
  }

  /** Retorna o arquivo de mídia de uma mensagem (para exibir imagem/áudio no chat). */
  async getMessageMedia(messageId: string, user: User) {
    const msg = await this.msgRepo.findOne({ where: { id: messageId } });
    if (!msg || !msg.mediaKey) throw new NotFoundException("Mídia não encontrada.");
    // Escopo por equipe (igual ao list): protege PII do cliente na mídia.
    const conv = await this.convRepo.findOne({ where: { id: msg.conversationId }, relations: ["lead"] });
    if (!conv) throw new NotFoundException("Conversa não encontrada.");
    await this.assertConvScope(conv, user);
    if (msg.mediaKey.startsWith("data:")) {
      const m = msg.mediaKey.match(/^data:(.+?);base64,(.*)$/s);
      return {
        buffer: Buffer.from(m ? m[2] : "", "base64"),
        contentType: msg.mediaMime || (m ? m[1] : "application/octet-stream"),
      };
    }
    const obj = await this.storage.getObject(msg.mediaKey);
    if (!obj) throw new NotFoundException("Mídia indisponível.");
    return { buffer: obj.buffer, contentType: msg.mediaMime || obj.contentType };
  }

  /** Histórico recente formatado para enviar à IA. */
  async getHistoryForAi(conversationId: string, limit = 20) {
    // As ÚLTIMAS `limit` mensagens (antes pegava as 20 mais ANTIGAS — em conversa
    // longa a IA não via o que o cliente acabou de dizer), em ordem cronológica.
    const messages = (
      await this.msgRepo.find({
        where: { conversationId },
        order: { createdAt: "DESC" },
        take: limit,
      })
    ).reverse();
    return messages.map((m) => ({
      role: m.direction === "in" ? ("user" as const) : ("assistant" as const),
      content: m.content,
    }));
  }
}
