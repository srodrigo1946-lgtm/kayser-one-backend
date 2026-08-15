import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import { Lead } from "../leads/lead.entity";
import { ConversationsService } from "../conversations/conversations.service";
import { LeadQueueService } from "../lead-queue/lead-queue.service";

interface DadosLead {
  name: string;
  phone: string;
  email?: string;
}

@Injectable()
export class MetaFormsService {
  private readonly logger = new Logger(MetaFormsService.name);

  constructor(
    private readonly conversations: ConversationsService,
    private readonly leadQueue: LeadQueueService,
    @InjectRepository(Lead)
    private readonly leadsRepo: Repository<Lead>,
    private readonly config: ConfigService
  ) {}

  /** Verificação do webhook (GET): devolve o challenge só se o token bater. */
  verify(mode: string, token: string, challenge: string): string | null {
    const esperado = this.config.get<string>("META_VERIFY_TOKEN");
    return mode === "subscribe" && !!esperado && token === esperado ? challenge : null;
  }

  /** Evento de leadgen: para cada lead novo, busca os dados e cria no CRM + fila. */
  async handleLeadgen(body: any): Promise<void> {
    const changes: any[] = (body?.entry ?? []).flatMap((e: any) => e?.changes ?? []);
    for (const ch of changes) {
      if (ch?.field !== "leadgen") continue;
      const leadgenId = ch?.value?.leadgen_id;
      if (!leadgenId) continue;
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
    const token = this.config.get<string>("META_PAGE_ACCESS_TOKEN");
    if (!token) {
      this.logger.warn("META_PAGE_ACCESS_TOKEN ausente — não busco o lead do formulário.");
      return null;
    }
    const { data } = await axios.get(`https://graph.facebook.com/v19.0/${leadgenId}`, {
      params: { access_token: token },
    });
    return this.mapFieldData(data?.field_data ?? []);
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
    const conv = await this.conversations.findOrCreateByPhone(dados.phone);
    if (conv.leadId) {
      this.logger.log(`Formulário: ${dados.phone} já tem lead — ignorado (duplicata).`);
      return;
    }
    const lead = await this.leadsRepo.save(
      this.leadsRepo.create({
        name: dados.name,
        phone: dados.phone,
        whatsapp: dados.phone,
        email: dados.email,
        origem: "formulario_meta",
        source: "formulario_meta",
      })
    );
    await this.conversations.setLead(conv.id, lead.id, dados.name);
    await this.leadQueue.enqueueLead({ conversationId: conv.id, leadId: lead.id });
    this.logger.log(`Formulário Meta → lead ${lead.id} (${dados.name}) criado e enfileirado.`);
  }
}
