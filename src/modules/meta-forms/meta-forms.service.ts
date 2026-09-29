import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { IsNull, Repository } from "typeorm";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
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
    return mode === "subscribe" && !!esperado && token === esperado ? challenge : null;
  }

  /**
   * Entrada DIRETA (Zapier/Make/qualquer ferramenta que POSTa o lead pronto).
   * Não precisa da Graph API nem de app do Meta — a ferramenta parceira já manda
   * nome/telefone/email. Protegido pelo mesmo Verify Token (colado na aba Integrações).
   */
  async recebeDireto(token: string, body: any): Promise<{ ok: boolean }> {
    if (token !== (await this.verifyToken())) return { ok: false };
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
    const { data: me } = await axios.get(`${GRAPH}/me`, { params: { access_token: token, fields: "id" } });
    const { data } = await axios.get(`${GRAPH}/${me.id}/leadgen_forms`, {
      params: { access_token: token, fields: "id,name,status,leads_count", limit: 100 },
    });
    return (data?.data ?? []).map((f: any) => ({ id: f.id, name: f.name, leads: f.leads_count ?? 0, status: f.status }));
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
  private async criarLead(dados: DadosLead): Promise<void> {
    dados.phone = telefoneWhatsapp(dados.phone);
    const conv = await this.conversations.findOrCreateByPhone(dados.phone);
    if (conv.leadId) {
      this.logger.log(`Formulário: ${dados.phone} já tem lead — ignorado (duplicata).`);
      return;
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
    await this.primeiroContato(conv.id, lead, atribuicao);
  }

  /**
   * Chama o cliente do formulário no WhatsApp pelo NÚMERO CENTRAL (instância do Diretor).
   * A conversa fica no número central — a resposta do cliente cai no fluxo normal
   * (Kayser fora do plantão / corretor no plantão). Falha em silêncio (não perde o lead).
   */
  private async primeiroContato(convId: string, lead: Lead, atribuicao: LeadQueueAssignment | null) {
    try {
      const users = this.leadsRepo.manager.getRepository(User);
      const diretor = await users.findOne({
        where: { role: UserRole.DIRETOR, empresaId: IsNull() },
        order: { createdAt: "ASC" },
      });
      if (!diretor) return;
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
    } catch (err) {
      this.logger.warn(`Formulário: não consegui chamar o lead ${lead.id} no WhatsApp: ${(err as Error).message}`);
    }
  }
}
