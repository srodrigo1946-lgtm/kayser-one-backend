import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { LessThan, Not, In, Repository } from "typeorm";
import { subDays } from "date-fns";
import { Lead, LeadStatus } from "../leads/lead.entity";
import { Settings } from "../settings/settings.entity";
import { SettingsService } from "../settings/settings.service";
import { WhatsappFlowService } from "../whatsapp/whatsapp-flow.service";
import { LeadHistoryService } from "../lead-history/lead-history.service";
import { LeadHistoryType } from "../lead-history/lead-history.entity";

@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);

  constructor(
    @InjectRepository(Lead)
    private readonly leadsRepo: Repository<Lead>,
    private readonly settings: SettingsService,
    private readonly whatsappFlow: WhatsappFlowService,
    private readonly history: LeadHistoryService
  ) {}

  // Textos padrão da saudação por horário (usados quando o Diretor não personalizou).
  private static readonly DEFAULTS = {
    manha:
      "Oi {nome}, bom dia! 😊 Passando pra saber se você ainda tem interesse no imóvel. Posso tirar dúvidas ou já agendar uma visita?",
    tarde:
      "Oi {nome}, boa tarde! 😊 Passando pra saber se você ainda tem interesse no imóvel. Posso tirar dúvidas ou já agendar uma visita?",
    noite:
      "Oie {nome}, boa noite! 😊 Passando pra saber se você ainda tem interesse no imóvel. Posso tirar dúvidas ou já agendar uma visita?",
  };

  /** Monta a mensagem do follow-up: template do horário atual, com {nome} = primeiro nome. */
  buildMessage(settings: Settings, name?: string): string {
    const h = new Date().getHours();
    const period = h < 12 ? "manha" : h < 18 ? "tarde" : "noite";
    const custom =
      period === "manha"
        ? settings.followupMsgManha
        : period === "tarde"
          ? settings.followupMsgTarde
          : settings.followupMsgNoite;
    const template = custom?.trim() || AutomationService.DEFAULTS[period];
    const firstName = name?.trim().split(" ")[0] || "";
    // Troca {nome} e limpa vírgula solta caso o lead não tenha nome ("Oi , bom dia" → "Oi, bom dia").
    return template.replace(/\{nome\}/g, firstName).replace(/\s+,/g, ",");
  }

  /** Roda todo dia às 9h. Pode ser disparado manualmente via runFollowup(). */
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async dailyFollowup() {
    return this.runFollowup();
  }

  async runFollowup() {
    const settings = await this.settings.get();
    if (!settings.followupEnabled) {
      return { skipped: true, reason: "Follow-up desativado nas configurações." };
    }

    const cutoff = subDays(new Date(), settings.followupDays);
    // Origens que recebem o follow-up (padrão: anúncio + cadastro manual).
    const sources =
      settings.followupSources?.length ? settings.followupSources : ["anuncio", "manual"];
    const leads = await this.leadsRepo.find({
      where: {
        lastContactAt: LessThan(cutoff),
        status: Not(In([LeadStatus.VENDA_GANHA, LeadStatus.VENDA_PERDIDA])),
        source: In(sources),
      },
      take: 100,
    });

    let sent = 0;
    for (const lead of leads) {
      const message = this.buildMessage(settings, lead.name);

      try {
        if (lead.phone && lead.responsavelId) {
          await this.whatsappFlow.sendManual(`user_${lead.responsavelId}`, lead.phone, message);
        }
        lead.lastContactAt = new Date();
        await this.leadsRepo.save(lead);
        await this.history.log({
          leadId: lead.id,
          type: LeadHistoryType.CONTATO,
          description: "Follow-up automático enviado (lead sem contato).",
        });
        sent++;
      } catch (err) {
        this.logger.warn(`Falha no follow-up do lead ${lead.id}: ${(err as Error).message}`);
      }
    }

    this.logger.log(`Follow-up automático: ${sent}/${leads.length} mensagens processadas.`);
    return { processed: leads.length, sent };
  }
}
