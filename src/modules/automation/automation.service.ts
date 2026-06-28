import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { LessThan, Not, In, Repository } from "typeorm";
import { subDays } from "date-fns";
import { Lead, LeadStatus } from "../leads/lead.entity";
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

  private greeting(): string {
    const h = new Date().getHours();
    if (h < 12) return "Bom dia";
    if (h < 18) return "Boa tarde";
    return "Boa noite";
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
    const leads = await this.leadsRepo.find({
      where: {
        lastContactAt: LessThan(cutoff),
        status: Not(In([LeadStatus.VENDA_GANHA, LeadStatus.VENDA_PERDIDA])),
      },
      take: 100,
    });

    let sent = 0;
    for (const lead of leads) {
      const firstName = lead.name?.split(" ")[0] || "tudo bem";
      const message = `Olá, ${firstName}! ${this.greeting()}! 😊 Passando para saber se ainda tem interesse em conquistar seu imóvel. Estou à disposição para esclarecer qualquer dúvida ou ajudar a agendar uma visita.`;

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
