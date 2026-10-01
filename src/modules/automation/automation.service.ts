import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { LessThan, Not, In, Repository } from "typeorm";
import { subDays } from "date-fns";
import { Lead, LeadStatus } from "../leads/lead.entity";
import { Settings } from "../settings/settings.entity";
import { SettingsService } from "../settings/settings.service";
import { WhatsappFlowService } from "../whatsapp/whatsapp-flow.service";
import { LeadHistoryService } from "../lead-history/lead-history.service";
import { LeadHistoryType } from "../lead-history/lead-history.entity";
import { Conversation } from "../conversations/conversation.entity";
import { LeadHistory } from "../lead-history/lead-history.entity";
import { User, UserRole } from "../users/user.entity";

/**
 * Primeiro nome "de gente" pro follow-up: tenta o nome do cadastro e depois o nome do
 * perfil do WhatsApp. Ignora número de telefone e "Contato WhatsApp", tira emoji/símbolo
 * e ajusta a caixa ("RODRIGO SILVA" → "Rodrigo"). Vazio = sem nome ("Oi, bom dia!").
 */
export function primeiroNome(...candidatos: (string | null | undefined)[]): string {
  for (const c of candidatos) {
    const bruto = (c || "").trim();
    if (!bruto || /^[\d\s()+-]+$/.test(bruto) || /^contato whatsapp$/i.test(bruto)) continue;
    const palavra = (bruto.split(/\s+/)[0] || "").replace(/[^\p{L}'-]/gu, "");
    if (palavra.length < 2) continue;
    return palavra.charAt(0).toLocaleUpperCase("pt-BR") + palavra.slice(1).toLocaleLowerCase("pt-BR");
  }
  return "";
}

/** Hora (0–23) em Brasília — o servidor roda em UTC. */
export function horaBrasilia(d = new Date()): number {
  return Number(d.toLocaleString("en-US", { timeZone: "America/Sao_Paulo", hour: "numeric", hourCycle: "h23" }));
}

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
  buildMessage(settings: Settings, name?: string, empreendimento?: string | null): string {
    const h = horaBrasilia();
    const period = h < 12 ? "manha" : h < 18 ? "tarde" : "noite";
    const custom =
      period === "manha"
        ? settings.followupMsgManha
        : period === "tarde"
          ? settings.followupMsgTarde
          : settings.followupMsgNoite;
    const template = custom?.trim() || AutomationService.DEFAULTS[period];
    const firstName = primeiroNome(name);
    // Troca {nome} e limpa vírgula solta caso o lead não tenha nome ("Oi , bom dia" → "Oi, bom dia").
    // Cita o empreendimento do lead (o cliente não lembrava "qual imóvel"): {imovel} no
    // texto, ou troca o "no imóvel" do texto padrão pelo nome do empreendimento.
    const emp = (empreendimento || "").trim();
    let t = template;
    if (t.includes("{imovel}")) t = t.replace(/\{imovel\}/g, emp || "imóvel");
    else if (emp) t = t.replace(/\bno im[óo]vel\b/i, `no ${emp}`);
    return t.replace(/\{nome\}/g, firstName).replace(/\s+,/g, ",");
  }

  /**
   * Roda todo dia às 9h de BRASÍLIA (antes era 9h UTC = 6h da manhã aqui).
   * Pode ser disparado manualmente via runFollowup().
   */
  @Cron("0 9 * * *", { timeZone: "America/Sao_Paulo" })
  async dailyFollowup() {
    return this.runFollowup();
  }

  /**
   * Lead "manual" só entra no follow-up se quem cadastrou foi o Diretor. O autor vem do
   * histórico ("Lead criado por…", tipo criacao, com o userId). Sem autor conhecido = fora.
   */
  private async soManuaisDoDiretor(leads: Lead[]): Promise<Lead[]> {
    const manuais = leads.filter((l) => l.source === "manual");
    if (!manuais.length) return leads;
    const diretores = await this.leadsRepo.manager
      .getRepository(User)
      .find({ where: { role: UserRole.DIRETOR }, select: ["id"] });
    const idsDiretor = new Set(diretores.map((u) => u.id));
    const criacoes = await this.leadsRepo.manager.getRepository(LeadHistory).find({
      where: { leadId: In(manuais.map((l) => l.id)), type: LeadHistoryType.CRIACAO },
      select: ["leadId", "userId"],
    });
    const doDiretor = new Set(criacoes.filter((h) => h.userId && idsDiretor.has(h.userId)).map((h) => h.leadId));
    return leads.filter((l) => l.source !== "manual" || doDiretor.has(l.id));
  }

  private chamando = false;

  /**
   * Diretor manda a mensagem de follow-up (com o nome) pros leads escolhidos — ou pros
   * "sem contato há 3+ dias" se não vier lista. Roda em segundo plano com a PROTEÇÃO do
   * WhatsApp (25–60s entre cada um) e no máximo 40 por vez.
   */
  async chamarLeads(leadIds?: string[]): Promise<{ agendados: number; minutos: number; motivo?: string }> {
    const settings = await this.settings.get();
    if (settings.whatsappPausado) return { agendados: 0, minutos: 0, motivo: "WhatsApp central está PAUSADO." };
    if (this.chamando) return { agendados: 0, minutos: 0, motivo: "Já tem um envio em andamento — aguarde terminar." };
    const where: any = {
      status: Not(In([LeadStatus.VENDA_GANHA, LeadStatus.VENDA_PERDIDA])),
      naoPerturbe: false,
    };
    if (leadIds?.length) where.id = In(leadIds.slice(0, 40));
    else where.lastContactAt = LessThan(subDays(new Date(), 3));
    const leads = (await this.leadsRepo.find({ where, order: { lastContactAt: "ASC" }, take: 40 })).filter((l) => !!l.phone);
    if (!leads.length) return { agendados: 0, minutos: 0, motivo: "Nenhum lead com telefone pra chamar." };

    this.chamando = true;
    const convRepo = this.leadsRepo.manager.getRepository(Conversation);
    (async () => {
      let enviados = 0;
      try {
        for (const lead of leads) {
          if (enviados > 0) await this.whatsappFlow.pausaEntreDisparos();
          if ((await this.settings.get()).whatsappPausado) break;
          const conv = await convRepo.findOne({ where: { leadId: lead.id } }).catch(() => null);
          const msg = this.buildMessage(settings, primeiroNome(lead.name, conv?.contactName), lead.empreendimento);
          try {
            await this.whatsappFlow.sendManual(lead.responsavelId || "", lead.phone, msg);
            await this.leadsRepo.update(lead.id, { lastContactAt: new Date() });
            await this.history.log({ leadId: lead.id, type: LeadHistoryType.CONTATO, description: "Mensagem enviada pelo Diretor (lead sem contato)." });
            enviados++;
          } catch (err) {
            this.logger.warn(`Chamar lead ${lead.id} falhou: ${(err as Error).message}`);
          }
        }
      } finally {
        this.chamando = false;
        this.logger.log(`Chamar leads: ${enviados}/${leads.length} mensagem(ns) enviada(s).`);
      }
    })();
    return { agendados: leads.length, minutos: Math.ceil((leads.length * 45) / 60) };
  }

  async runFollowup() {
    const settings = await this.settings.get();
    if (!settings.followupEnabled) {
      return { skipped: true, reason: "Follow-up desativado nas configurações." };
    }
    if (settings.whatsappPausado) {
      return { skipped: true, reason: "WhatsApp central pausado (contingência)." };
    }

    const cutoff = subDays(new Date(), settings.followupDays);
    // Origens que recebem o follow-up (padrão: número central = anúncio + WhatsApp, e
    // cadastro manual). Manual vale SÓ pro lead que o DIRETOR cadastrou (regra do Rodrigo).
    const sources =
      settings.followupSources?.length ? settings.followupSources : ["anuncio", "whatsapp", "manual"];
    const encontrados = await this.leadsRepo.find({
      where: {
        lastContactAt: LessThan(cutoff),
        status: Not(In([LeadStatus.VENDA_GANHA, LeadStatus.VENDA_PERDIDA])),
        source: In(sources),
        naoPerturbe: false,
      },
      order: { lastContactAt: "ASC" },
      // PROTEÇÃO: no máximo 40 por dia (o resto vai nos dias seguintes).
      take: 40,
    });
    const leads = await this.soManuaisDoDiretor(encontrados);

    let sent = 0;
    const convRepo = this.leadsRepo.manager.getRepository(Conversation);
    for (const lead of leads) {
      // PROTEÇÃO: 25-60s entre um cliente e outro (nada de rajada às 9h).
      if (sent > 0) await this.whatsappFlow.pausaEntreDisparos();
      // Nome do cadastro; se for número/"Contato WhatsApp", usa o nome do perfil do WhatsApp.
      const conv = await convRepo.findOne({ where: { leadId: lead.id } }).catch(() => null);
      const message = this.buildMessage(settings, primeiroNome(lead.name, conv?.contactName), lead.empreendimento);

      try {
        if (!lead.phone) continue;
        // Sai pelo número central (sendManual resolve); antes passava "user_<id>" errado.
        await this.whatsappFlow.sendManual(lead.responsavelId || "", lead.phone, message);
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
