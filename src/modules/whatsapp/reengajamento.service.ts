import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Cron } from "@nestjs/schedule";
import { IsNull, Repository } from "typeorm";
import { Lead, LeadStatus } from "../leads/lead.entity";
import { bloquearTelefones } from "../leads/bloqueio";
import { ConversationsService } from "../conversations/conversations.service";
import { SettingsService } from "../settings/settings.service";
import { WhatsappService, pedeParar } from "./whatsapp.service";
import { LeadQueueService } from "../lead-queue/lead-queue.service";
import { AiService } from "../ai/ai.service";
import { PropertiesService } from "../properties/properties.service";
import { acharPorNome } from "./ia-one.util";

/** 25 por hora, das 9h às 21h (último lote às 20h) — pedido do Rodrigo 06/10/2026. */
export const REENGAJAR_POR_HORA = 25;

const primeiroNome = (n?: string | null) => ((n || "").trim().split(/\s+/)[0] || "").replace(/^\w/, (c) => c.toUpperCase());

/** Mensagens variadas (texto igual em massa é o que mais gera denúncia no WhatsApp). */
export function mensagemReengajar(nome: string | null | undefined, empreendimento: string | null | undefined, i: number): string {
  const n = primeiroNome(nome);
  const oi = n ? `Oi, ${n}!` : "Oi!";
  const emp = (empreendimento || "").trim();
  const sobre = emp ? `o ${emp}` : "os nossos empreendimentos";
  const modelos = [
    `${oi} Tudo bem? Aqui é da Kayser 😊 Faz um tempinho que conversamos sobre ${sobre}. Saíram condições novas este mês — ainda faz sentido pra você?`,
    `${oi} Passando pra saber se você ainda pensa em comprar seu imóvel. Temos novidades sobre ${sobre} com condições especiais. Posso te contar?`,
    `${oi} Aqui é da Kayser. Lembrei de você porque abriram condições novas pra ${sobre} 🏡 Quer que eu te passe os detalhes?`,
    `${oi} Tudo certo? Seu momento pode ter mudado desde a última conversa sobre ${sobre}. Este mês está com condição diferenciada — tem interesse em saber?`,
    `${oi} Ainda está procurando imóvel? Separei novidades sobre ${sobre} que podem te interessar. Posso te mandar?`,
    `${oi} Aqui é da Kayser 😊 Voltou a pensar em sair do aluguel? Temos condições novas pra ${sobre}. Me conta se quer saber mais!`,
  ];
  return `${modelos[i % modelos.length]}\n\n(Se não quiser mais receber, é só responder NÃO.)`;
}

/** Resposta do cliente ao reengajamento: quer (fila), não quer (remove) ou outra coisa. */
export function classificarResposta(texto: string): "sim" | "nao" | "outro" {
  const t = (texto || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  if (!t) return "outro";
  if (pedeParar(texto) || /^(nao|n|nao obrigad\w*|obrigad\w*,? nao|sem interesse|nao tenho interesse|nao quero|ja comprei|ja comprei outro|nao preciso)\b[.!]*/.test(t) || /\b(sem interesse|nao tenho (mais )?interesse|nao quero|ja comprei)\b/.test(t)) {
    return "nao";
  }
  // Qualquer sinal positivo (pedido do Rodrigo 06/10): interesse, mais informação, gostei, valor/condições, visita.
  if (
    /^(sim|s|ss|quero|tenho|pode|claro|opa|bora|manda|gostei|legal|show|top|massa|interessante|ok|okay|beleza|blz|me (manda|conta|passa|envia|explica))\b/.test(t) ||
    /\b(tenho interesse|quero saber|saber mais|me interessa|interessad|gostaria|gostei|pode mandar|pode me (mandar|passar|enviar)|manda (mais )?(as )?(informac|info|detalhe|valor|condic|foto|video|book)|mais informac|mais detalhe|quais (as )?condic|qual (o )?(valor|preco)|quanto (custa|fica|e)|valores|condicoes|como funciona|quero ver|agendar|visita|simulac|financ)/.test(t)
  ) {
    return "sim";
  }
  return "outro";
}

@Injectable()
export class ReengajamentoService {
  private readonly logger = new Logger(ReengajamentoService.name);
  private rodando = false;

  constructor(
    @InjectRepository(Lead) private readonly leads: Repository<Lead>,
    private readonly conversations: ConversationsService,
    private readonly settings: SettingsService,
    private readonly whatsapp: WhatsappService,
    private readonly fila: LeadQueueService,
    private readonly ai: AiService,
    private readonly imoveis: PropertiesService
  ) {}

  /** Todo dia, de hora em hora das 9h às 20h (termina ~21h): manda pra 25 "sem interesse". */
  @Cron("0 9-20 * * *", { timeZone: "America/Sao_Paulo" })
  async loteDaHora() {
    const s: any = await this.settings.get().catch(() => null);
    if (!s || s.reengajarAtivo === false || this.rodando) return;
    const central = await this.conversations.diretorCentralId();
    if (!central || !(await this.whatsapp.conectado(`user_${central}`))) {
      this.logger.warn("Reengajamento: número central desconectado — lote pulado.");
      return;
    }
    const lote = await this.leads.find({
      where: { status: LeadStatus.VENDA_PERDIDA, reengajadoEm: IsNull(), naoPerturbe: false } as any,
      order: { updatedAt: "ASC" },
      take: REENGAJAR_POR_HORA * 2, // sobra pra pular quem não tem telefone
    });
    const fila = lote.filter((l) => (l.phone || l.whatsapp || "").replace(/\D/g, "").length >= 10).slice(0, REENGAJAR_POR_HORA);
    if (!fila.length) return;
    // Só cita empreendimento que EXISTE no cadastro (o campo às vezes guarda resposta de formulário, ex.: "Agende sua visita!").
    const nomesImoveis = ((await this.imoveis.findAll().catch(() => [])) as any[]).map((p) => p.name as string);
    const empreendimentoReal = (e?: string | null) => (e ? acharPorNome(nomesImoveis, e, (x) => x) ?? null : null);
    this.rodando = true;
    let enviados = 0;
    try {
      for (let i = 0; i < fila.length; i++) {
        const l = fila[i];
        // Marca ANTES de mandar: se o servidor reiniciar no meio, ninguém recebe 2x.
        await this.leads.update(l.id, { reengajadoEm: new Date() } as any);
        const phone = (l.phone || l.whatsapp || "").replace(/\D/g, "");
        try {
          const conv = await this.conversations.findOrCreateByPhone(phone, central);
          if (!conv.leadId) await this.conversations.setLead(conv.id, l.id, l.name).catch(() => null);
          const texto = mensagemReengajar(l.name, empreendimentoReal(l.empreendimento), i + new Date().getHours());
          await this.whatsapp.sendText(`user_${central}`, phone, texto);
          await this.conversations.addMessage(conv.id, texto, "out", true);
          enviados++;
        } catch (e) {
          this.logger.warn(`Reengajamento: falhou pro lead ${l.id} (${(e as Error).message}).`);
          if (/pausad/i.test((e as Error).message)) break; // WhatsApp em pausa (proteção): para o lote
        }
        // Cadência: ~2 a 2,5 min entre mensagens (25 em ~55 min), com variação aleatória.
        if (i < fila.length - 1) await new Promise((r) => setTimeout(r, 120_000 + Math.floor(Math.random() * 30_000)));
      }
    } finally {
      this.rodando = false;
      this.logger.log(`Reengajamento: ${enviados}/${fila.length} mensagem(ns) enviada(s) neste lote.`);
    }
  }

  /**
   * Cliente reengajado respondeu (até 15 dias depois). "Não" → sai do Kayser (e o
   * telefone não volta); "sim" → vai pra fila de atendimento. Devolve true se tratou.
   */
  async tratarResposta(leadId: string, texto: string, instancia: string, destino: string): Promise<boolean> {
    const lead = await this.leads.findOne({ where: { id: leadId } });
    const quando = (lead as any)?.reengajadoEm ? new Date((lead as any).reengajadoEm).getTime() : 0;
    if (!lead || lead.status !== LeadStatus.VENDA_PERDIDA || !quando || Date.now() - quando > 15 * 86_400_000) return false;
    // Palavras conhecidas primeiro; o que não der pra saber, a IA decide.
    let r = classificarResposta(texto);
    if (r === "outro") r = await this.ai.classificarInteresse(texto);
    if (r === "outro") return false;
    const nome = primeiroNome(lead.name);
    if (r === "nao") {
      await this.whatsapp
        .sendText(instancia, destino, `Tudo bem${nome ? `, ${nome}` : ""}! Não vamos mais te enviar mensagens. Obrigado pela atenção 🙏`)
        .catch(() => null);
      await bloquearTelefones(this.leads.manager, lead.phone, lead.whatsapp).catch(() => null);
      await this.leads.remove(lead).catch((e) => this.logger.warn(`Reengajamento: não removi o lead ${lead.id} (${e.message}).`));
      this.logger.log(`Reengajamento: lead ${lead.id} disse NÃO — removido do Kayser.`);
      return true;
    }
    await this.leads.update(lead.id, { status: LeadStatus.NOVO_LEAD } as any);
    await this.whatsapp
      .sendText(instancia, destino, `Que ótimo${nome ? `, ${nome}` : ""}! 😊 Já vou te colocar em contato com um especialista da Kayser.`)
      .catch(() => null);
    const f = await this.fila.distribuirLeadManual(lead.id).catch(() => null);
    this.logger.log(`Reengajamento: lead ${lead.id} tem interesse — fila: ${f?.status ?? "erro"}.`);
    return true;
  }
}
