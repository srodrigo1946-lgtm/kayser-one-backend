import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, IsNull, MoreThan, Repository } from "typeorm";
import { Cron } from "@nestjs/schedule";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import { timingSafeEqual } from "crypto";
import { Lead } from "../leads/lead.entity";
import { ConversationsService } from "../conversations/conversations.service";
import { LeadQueueService } from "../lead-queue/lead-queue.service";
import { SettingsService } from "../settings/settings.service";
import { Property } from "../properties/property.entity";
import { detectarEmpreendimento } from "../knowledge/knowledge.service";
import { WhatsappService } from "../whatsapp/whatsapp.service";
import { User, UserRole } from "../users/user.entity";
import { Conversation } from "../conversations/conversation.entity";
import { LeadQueueAssignment } from "../lead-queue/lead-queue-assignment.entity";
import { primeiroNome } from "../automation/automation.service";
import { Message } from "../conversations/message.entity";

/** Traduz o erro da Graph API (token vencido/invalidado, sem permissão...). */
export function erroMeta(err: any): string {
  const e = err?.response?.data?.error;
  if (!e) return `Não consegui falar com o Facebook: ${err?.message ?? "erro"}`;
  if (e.code === 190) {
    return "O Page Access Token do Meta venceu ou foi invalidado (troca de senha, saída do app ou do Business). Gere um token novo e cole em \"Page Access Token\".";
  }
  if (e.code === 10 || e.code === 200 || /permission/i.test(e.message ?? "")) {
    return `O token não tem permissão pra ler os leads (leads_retrieval / pages_manage_ads). Meta: ${e.message}`;
  }
  return `Meta recusou: ${e.message ?? "erro"}`;
}

/** Variações do telefone BR pra achar lead já cadastrado (com/sem 55). */
export function variacoesTelefone(p: string): string[] {
  const d = (p || "").replace(/\D/g, "");
  if (!d) return [];
  const sem55 = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
  return Array.from(new Set([d, sem55, `55${sem55}`]));
}

/**
 * Compara o token recebido com o esperado. Token esperado VAZIO = sempre recusa
 * (Sofia, 29/09: senão `?token=` vazio passava e disparava WhatsApp pelo central).
 * Comparação em tempo constante.
 */
export function tokenConfere(recebido: string | undefined, esperado: string): boolean {
  if (!esperado || !recebido) return false;
  const a = Buffer.from(String(recebido));
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Telefone BR só com dígitos e com o 55 (o WhatsApp responde como 55DDDNÚMERO). */
export function telefoneWhatsapp(phone: string): string {
  const d = (phone || "").replace(/\D/g, "");
  return d.length === 10 || d.length === 11 ? `55${d}` : d;
}

/**
 * 1ª mensagem pro cliente que preencheu o formulário. No plantão: avisa o nome do
 * corretor. Fora dele: o Kayser se apresenta (IA) e já puxa conversa. Sem IA ligada:
 * aviso simples de que um especialista vai chamar.
 */
export function mensagemFormulario(p: {
  nome: string;
  empreendimento?: string | null;
  corretor?: string | null;
  kayser: boolean;
}): string {
  const oi = p.nome ? `Olá, ${p.nome}!` : "Olá!";
  const sobre = p.empreendimento ? `sobre o *${p.empreendimento}*` : "sobre o imóvel";
  if (p.corretor) {
    return `${oi} 👋 Recebemos seu cadastro ${sobre}. Você será atendido pelo nosso especialista *${p.corretor}*, que já vai falar com você por aqui. 🏡`;
  }
  if (p.kayser) {
    return `${oi} 👋 Eu sou o *Kayser*, assistente de inteligência artificial da equipe. Vi que você se cadastrou pra saber mais ${sobre} 🏡 Posso te mandar fotos, valores e condições, ou já agendar uma visita ao stand. O que prefere?`;
  }
  return `${oi} 👋 Recebemos seu cadastro ${sobre}. Em breve um dos nossos especialistas vai falar com você por aqui. 🏡`;
}

const GRAPH = "https://graph.facebook.com/v26.0";

interface DadosLead {
  name: string;
  phone: string;
  email?: string;
  /** Nome do formulário (ex.: "Ilha stay lead") — vira campanha e indica o empreendimento. */
  formulario?: string;
  /** ID do formulário (vem da Graph API — confere de novo com a lista permitida). */
  formId?: string;
}

@Injectable()
export class MetaFormsService {
  private readonly logger = new Logger(MetaFormsService.name);

  constructor(
    private readonly conversations: ConversationsService,
    private readonly leadQueue: LeadQueueService,
    @InjectRepository(Lead)
    private readonly leadsRepo: Repository<Lead>,
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
    private readonly whatsapp: WhatsappService
  ) {}

  /** Tokens: primeiro o que o Diretor colou nas Configurações, senão a env. */
  private async verifyToken(): Promise<string> {
    const s = await this.settings.get().catch(() => null);
    return s?.metaVerifyToken || this.config.get<string>("META_VERIFY_TOKEN") || "";
  }
  private async pageToken(): Promise<string> {
    const s = await this.settings.get().catch(() => null);
    return s?.metaPageToken || this.config.get<string>("META_PAGE_ACCESS_TOKEN") || "";
  }

  /** Verificação do webhook (GET): devolve o challenge só se o token bater. */
  async verify(mode: string, token: string, challenge: string): Promise<string | null> {
    const esperado = await this.verifyToken();
    return mode === "subscribe" && tokenConfere(token, esperado) ? challenge : null;
  }

  /**
   * Entrada DIRETA (Zapier/Make/qualquer ferramenta que POSTa o lead pronto).
   * Não precisa da Graph API nem de app do Meta — a ferramenta parceira já manda
   * nome/telefone/email. Protegido pelo mesmo Verify Token (colado na aba Integrações).
   */
  async recebeDireto(token: string, body: any): Promise<{ ok: boolean }> {
    if (!tokenConfere(token, await this.verifyToken())) return { ok: false };
    const pega = (...ks: string[]) => {
      for (const k of ks) if (body?.[k]) return String(body[k]);
      return "";
    };
    const phone = pega("phone", "telefone", "phone_number", "celular", "whatsapp").replace(/\D/g, "");
    if (!phone) return { ok: false };
    await this.criarLead({
      name: pega("name", "nome", "full_name") || "Contato do formulário",
      phone,
      email: pega("email", "e-mail") || undefined,
    });
    return { ok: true };
  }

  /** IDs dos formulários permitidos (Configurações → Integrações). Vazio = todos. */
  private async formsPermitidos(): Promise<string[]> {
    const s = await this.settings.get().catch(() => null);
    return (s?.metaFormIds || "").split(",").map((x) => x.trim()).filter(Boolean);
  }

  /** Formulários da Página (pra tela de Configurações marcar quais entram). */
  async listarFormularios(): Promise<{ id: string; name: string; leads: number; status: string }[]> {
    const token = await this.pageToken();
    if (!token) return [];
    try {
      const { data: me } = await axios.get(`${GRAPH}/me`, { params: { access_token: token, fields: "id" } });
      const { data } = await axios.get(`${GRAPH}/${me.id}/leadgen_forms`, {
        params: { access_token: token, fields: "id,name,status,leads_count", limit: 100 },
      });
      return (data?.data ?? []).map((f: any) => ({ id: f.id, name: f.name, leads: f.leads_count ?? 0, status: f.status }));
    } catch (err: any) {
      throw new BadRequestException(erroMeta(err));
    }
  }

  /** Evento de leadgen: para cada lead novo, busca os dados e cria no CRM + fila. */
  async handleLeadgen(body: any): Promise<void> {
    const changes: any[] = (body?.entry ?? []).flatMap((e: any) => e?.changes ?? []);
    const permitidos = await this.formsPermitidos();
    for (const ch of changes) {
      if (ch?.field !== "leadgen") continue;
      const leadgenId = ch?.value?.leadgen_id;
      if (!leadgenId) continue;
      // Só os formulários marcados em Configurações (ex.: só o "Ilha stay lead").
      const formId = ch?.value?.form_id ? String(ch.value.form_id) : "";
      if (permitidos.length && formId && !permitidos.includes(formId)) {
        this.logger.log(`Formulário ${formId} fora da lista — lead ${leadgenId} ignorado.`);
        continue;
      }
      try {
        const dados = await this.fetchLead(leadgenId);
        // Confere de novo com o form_id REAL (Graph API): evento sem form_id não fura o filtro.
        if (dados?.formId && permitidos.length && !permitidos.includes(dados.formId)) {
          this.logger.log(`Formulário ${dados.formId} fora da lista — lead ${leadgenId} ignorado.`);
          continue;
        }
        if (dados?.phone) await this.criarLead(dados);
      } catch (err) {
        this.logger.warn(`Falha ao processar leadgen ${leadgenId}: ${(err as Error).message}`);
      }
    }
  }

  /** Busca os dados do lead na Graph API. Null se não há token configurado. */
  private async fetchLead(leadgenId: string): Promise<DadosLead | null> {
    const token = await this.pageToken();
    if (!token) {
      this.logger.warn("META_PAGE_ACCESS_TOKEN ausente — não busco o lead do formulário.");
      return null;
    }
    const { data } = await axios.get(`${GRAPH}/${leadgenId}`, {
      params: { access_token: token, fields: "field_data,form_id" },
    });
    const dados = this.mapFieldData(data?.field_data ?? []);
    if (data?.form_id) dados.formId = String(data.form_id);
    if (data?.form_id) {
      const form = await axios
        .get(`${GRAPH}/${data.form_id}`, { params: { access_token: token, fields: "name" } })
        .catch(() => null);
      dados.formulario = form?.data?.name || undefined;
    }
    return dados;
  }

  /** Mapeia o field_data do Meta (nomes de campo variam) para nome/telefone/email. */
  private mapFieldData(fieldData: Array<{ name: string; values: string[] }>): DadosLead {
    const pega = (chaves: string[]): string => {
      const campo = fieldData.find((f) => chaves.some((k) => f.name?.toLowerCase().includes(k)));
      return campo?.values?.[0] ?? "";
    };
    return {
      name: pega(["full_name", "name", "nome"]) || "Contato do formulário",
      phone: pega(["phone", "telefone", "celular"]).replace(/\D/g, ""),
      email: pega(["email", "e-mail"]) || undefined,
    };
  }

  /** Cria Lead + Conversa e enfileira. Idempotente por telefone (conversa já com lead = duplicata). */
  private async criarLead(dados: DadosLead, contatarAgora = true): Promise<boolean> {
    dados.phone = telefoneWhatsapp(dados.phone);
    // Já existe lead com esse telefone (planilha, manual, formulário)? Não duplica.
    const tels = variacoesTelefone(dados.phone);
    const existente = await this.leadsRepo.findOne({ where: [{ phone: In(tels) }, { whatsapp: In(tels) }] });
    if (existente) {
      this.logger.log(`Formulário: ${dados.phone} já é lead (${existente.id}) — ignorado.`);
      return false;
    }
    const conv = await this.conversations.findOrCreateByPhone(dados.phone);
    if (conv.leadId) {
      this.logger.log(`Formulário: ${dados.phone} já tem lead — ignorado (duplicata).`);
      return false;
    }
    // O nome do formulário indica o empreendimento ("Ilha stay lead" → Ilha stay home Resort).
    let imovel: Property | null = null;
    if (dados.formulario) {
      const props = await this.leadsRepo.manager.getRepository(Property).find({ where: { active: true } }).catch(() => []);
      imovel = detectarEmpreendimento(dados.formulario, props);
    }
    const lead = await this.leadsRepo.save(
      this.leadsRepo.create({
        name: dados.name,
        phone: dados.phone,
        whatsapp: dados.phone,
        email: dados.email,
        origem: "formulario_meta",
        source: "formulario_meta",
        campanha: dados.formulario,
        ...(imovel ? { propertyId: imovel.id, empreendimento: imovel.name } : {}),
      } as Partial<Lead>) as Lead
    );
    await this.conversations.setLead(conv.id, lead.id, dados.name);
    const atribuicao = await this.leadQueue.enqueueLead({ conversationId: conv.id, leadId: lead.id });
    this.logger.log(`Formulário Meta → lead ${lead.id} (${dados.name}) criado e enfileirado.`);
    // Pedido do Rodrigo: entrou lead do formulário → o Kayser já chama no WhatsApp.
    // Em lote (puxar do Facebook) NÃO dispara aqui: o contatarPendentes manda aos poucos.
    if (contatarAgora) await this.primeiroContato(conv.id, lead, atribuicao);
    return true;
  }

  private sincronizando = false;

  /**
   * Puxa do Facebook os leads dos formulários marcados das últimas `horas` e traz
   * os que faltam pro Kayser (entram na fila). Rede de segurança do webhook:
   * roda sozinho a cada 15 min e pelo botão em Configurações.
   */
  async sincronizar(horas = 72): Promise<{ encontrados: number; novos: number; erro?: string }> {
    if (this.sincronizando) return { encontrados: 0, novos: 0, erro: "Já está puxando, aguarde." };
    this.sincronizando = true;
    let encontrados = 0;
    let novos = 0;
    try {
      const token = await this.pageToken();
      if (!token) return { encontrados, novos, erro: "Token da Página do Meta não configurado." };
      const forms = await this.formsPermitidos();
      if (!forms.length) return { encontrados, novos, erro: "Nenhum formulário marcado em Configurações." };
      const desde = Math.floor((Date.now() - horas * 3600_000) / 1000);
      for (const formId of forms) {
        const form = await axios
          .get(`${GRAPH}/${formId}`, { params: { access_token: token, fields: "name" } })
          .catch(() => null);
        let url: string | null = `${GRAPH}/${formId}/leads`;
        let params: any = {
          access_token: token,
          fields: "id,created_time,field_data",
          limit: 100,
          filtering: JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: desde }]),
        };
        for (let pagina = 0; url && pagina < 10; pagina++) {
          const { data }: any = await axios.get(url, { params });
          for (const l of data?.data ?? []) {
            encontrados++;
            const dados = this.mapFieldData(l.field_data ?? []);
            if (!dados.phone) continue;
            dados.formId = formId;
            dados.formulario = form?.data?.name || undefined;
            try {
              if (await this.criarLead(dados, false)) novos++;
            } catch (err) {
              this.logger.warn(`Sincronizar: falha no lead ${l.id}: ${(err as Error).message}`);
            }
          }
          url = data?.paging?.next ?? null;
          params = undefined; // o "next" já vem com tudo na URL
        }
      }
      if (novos) this.logger.log(`Sincronizar formulários: ${novos} lead(s) novo(s) de ${encontrados}.`);
      return { encontrados, novos };
    } catch (err: any) {
      const msg = erroMeta(err);
      this.logger.warn(`Sincronizar formulários falhou: ${msg}`);
      return { encontrados, novos, erro: String(msg).slice(0, 200) };
    } finally {
      this.sincronizando = false;
    }
  }

  /** Automático: a cada 15 min confere o Facebook (lead não se perde se o webhook falhar). */
  @Cron("*/15 * * * *", { timeZone: "America/Sao_Paulo" })
  async sincronizarAutomatico() {
    if (!(await this.pageToken())) return;
    await this.sincronizar(24);
  }

  /**
   * Automático: WhatsApp voltou (conectado e sem pausa)? Manda a 1ª mensagem pros
   * leads de formulário das últimas 72h que ficaram SEM nenhuma mensagem. Poucos por
   * vez (3 a cada 10 min) pra não ser bloqueado de novo.
   */
  @Cron("*/10 * * * *", { timeZone: "America/Sao_Paulo" })
  async contatarPendentes(limite = 3) {
    if (await this.whatsapp.pausado()) return { enviados: 0, motivo: "pausado" };
    const users = this.leadsRepo.manager.getRepository(User);
    const diretor = await users.findOne({ where: { role: UserRole.DIRETOR, empresaId: IsNull() }, order: { createdAt: "ASC" } });
    if (!diretor) return { enviados: 0 };
    if (!(await this.whatsapp.conectado(`user_${diretor.id}`))) return { enviados: 0, motivo: "desconectado" };
    const leads = await this.leadsRepo.find({
      where: { source: "formulario_meta" as any, createdAt: MoreThan(new Date(Date.now() - 72 * 3600_000)) },
      order: { createdAt: "ASC" },
      take: 200,
    });
    const convRepo = this.leadsRepo.manager.getRepository(Conversation);
    const msgRepo = this.leadsRepo.manager.getRepository(Message);
    const filaRepo = this.leadsRepo.manager.getRepository(LeadQueueAssignment);
    let enviados = 0;
    for (const lead of leads) {
      if (enviados >= limite) break;
      const conv = await convRepo.findOne({ where: { leadId: lead.id } });
      if (!conv) continue;
      if ((await msgRepo.count({ where: { conversationId: conv.id } })) > 0) continue;
      const atrib = await filaRepo.findOne({ where: { conversationId: conv.id }, order: { assignedAt: "DESC" } });
      if (enviados > 0) await this.whatsapp.pausaEntreDisparos();
      if (await this.primeiroContato(conv.id, lead, atrib)) enviados++;
      else break; // falhou (WhatsApp ainda com problema): tenta de novo na próxima rodada
    }
    if (enviados) this.logger.log(`WhatsApp de volta: 1ª mensagem enviada a ${enviados} lead(s) pendente(s).`);
    return { enviados };
  }

  /**
   * Chama o cliente do formulário no WhatsApp pelo NÚMERO CENTRAL (instância do Diretor).
   * A conversa fica no número central — a resposta do cliente cai no fluxo normal
   * (Kayser fora do plantão / corretor no plantão). Falha em silêncio (não perde o lead).
   */
  private async primeiroContato(convId: string, lead: Lead, atribuicao: LeadQueueAssignment | null): Promise<boolean> {
    try {
      const users = this.leadsRepo.manager.getRepository(User);
      const diretor = await users.findOne({
        where: { role: UserRole.DIRETOR, empresaId: IsNull() },
        order: { createdAt: "ASC" },
      });
      if (!diretor) return false;
      // Conversa pertence ao número central (responder / avisar corretor pelo número certo).
      const convRepo = this.leadsRepo.manager.getRepository(Conversation);
      const conv = await convRepo.findOne({ where: { id: convId } });
      if (conv && !conv.instanceOwnerId) {
        await convRepo.update(convId, {
          instanceOwnerId: diretor.id,
          ...(conv.assignedToId ? {} : { assignedToId: diretor.id }),
        });
      }
      let corretor: string | null = null;
      if (atribuicao?.status === "pendente" && atribuicao.assignedToId) {
        const u = await users.findOne({ where: { id: atribuicao.assignedToId } });
        corretor = u?.name ? u.name.split(" ").slice(0, 2).join(" ") : null;
      }
      const s = await this.settings.get();
      if (s.whatsappPausado) {
        this.logger.log(`Formulário: WhatsApp pausado — lead ${lead.id} na fila; 1ª mensagem sai quando voltar.`);
        return false;
      }
      const msg = mensagemFormulario({
        nome: primeiroNome(lead.name),
        empreendimento: lead.empreendimento,
        corretor,
        kayser: !corretor && !!s.aiAutoReply,
      });
      await this.whatsapp.sendText(`user_${diretor.id}`, lead.phone, msg);
      // isAI=true: é o Kayser/sistema falando — não conta como "humano respondeu".
      await this.conversations.addMessage(convId, msg, "out", true);
      this.logger.log(`Formulário: Kayser chamou o lead ${lead.id} no WhatsApp.`);
      return true;
    } catch (err) {
      this.logger.warn(`Formulário: não consegui chamar o lead ${lead.id} no WhatsApp: ${(err as Error).message}`);
      return false;
    }
  }
}
