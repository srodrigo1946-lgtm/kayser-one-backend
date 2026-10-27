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
import * as XLSX from "xlsx";

/** 25 por hora, das 9h às 22h (último lote às 21h) — Rodrigo 06/10, horário até 22h em 25/10/2026. */
export const REENGAJAR_POR_HORA = 25;

/** 1º contato com lead da planilha de um gestor (Fila da Equipe) — variado, como o reengajamento. */
export function mensagemPrimeiroContato(nome: string | null | undefined, empreendimento: string | null | undefined, i: number): string {
  const n = primeiroNome(nome);
  const oi = n ? `Oi, ${n}!` : "Oi!";
  const emp = (empreendimento || "").trim();
  const sobre = emp ? `o ${emp}` : "imóveis com condições especiais";
  const modelos = [
    `${oi} Tudo bem? Aqui é da Kayser 😊 Você demonstrou interesse em ${sobre}. Ainda está procurando o seu imóvel?`,
    `${oi} Aqui é da Kayser. Temos novidades sobre ${sobre} e lembrei de você 🏡 Posso te contar?`,
    `${oi} Tudo certo? Sou da Kayser e estou entrando em contato sobre ${sobre}. Ainda faz sentido pra você?`,
    `${oi} Aqui é da Kayser 😊 Pensando em sair do aluguel? Separei condições sobre ${sobre}. Quer saber mais?`,
  ];
  return `${modelos[i % modelos.length]}\n\n(Se não quiser receber, é só responder NÃO.)`;
}

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
/** Metade da hora pra cada fila; se uma tiver menos, a outra usa a sobra. Intercala as duas. */
export function dividirHora<T>(equipe: T[], diretor: T[], total: number): T[] {
  const metade = Math.ceil(total / 2);
  const nEquipe = Math.min(equipe.length, Math.max(metade, total - diretor.length));
  const nDiretor = Math.min(diretor.length, total - nEquipe);
  const a = equipe.slice(0, nEquipe), b = diretor.slice(0, nDiretor), out: T[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}

export function classificarResposta(texto: string): "sim" | "nao" | "outro" {
  const t = (texto || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  if (!t) return "outro";
  if (pedeParar(texto) || /^(nao|n|nao obrigad\w*|obrigad\w*,? nao|sem interesse|nao tenho interesse|nao quero|ja comprei|ja comprei outro|nao preciso)\b[.!]*/.test(t) || /\b(sem interesse|nao tenho (mais )?interesse|nao quero|ja comprei)\b/.test(t) || /\bnao[.!\s]*$/.test(t)) {
    // "Quero não" / "agora não" (fim com "não") também é não.
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

  /**
   * Todo dia, de hora em hora das 9h às 21h (termina ~22h), até 25 mensagens pelo número
   * central: primeiro os leads das Filas da Equipe ligadas pelo Diretor (1º contato), depois
   * os "sem interesse" (reengajamento). O total por hora não muda — protege o número.
   */
  @Cron("0 9-21 * * *", { timeZone: "America/Sao_Paulo" })
  async loteDaHora() {
    const s: any = await this.settings.get().catch(() => null);
    if (!s || this.rodando) return;
    const central = await this.conversations.diretorCentralId();
    if (!central || !(await this.whatsapp.conectado(`user_${central}`))) {
      this.logger.warn("Reengajamento: número central desconectado — lote pulado.");
      return;
    }
    const temTelefone = (l: any) => (l.phone || l.whatsapp || "").replace(/\D/g, "").length >= 10;
    // Fila da Equipe: só filas LIGADAS (o Diretor liga/desliga) e lead ainda com o gestor.
    const daEquipe: any[] = (
      await this.leads
        .query(
          // Lead com o gestor OU já repartido pra um corretor dele na planilha — a IA chama do mesmo jeito.
          `SELECT l.id, l.name, l.phone, l.whatsapp, l.empreendimento, l."filaEquipeId", l."responsavelId"::text AS "responsavelId" FROM leads l
             JOIN fila_equipe f ON f."gestorId" = l."filaEquipeId" AND f.ativo = true
            WHERE l."reengajadoEm" IS NULL AND l."naoPerturbe" = false
            ORDER BY l."createdAt" ASC LIMIT $1`,
          [REENGAJAR_POR_HORA * 2]
        )
        .catch(() => [])
    ).filter(temTelefone);
    const semInteresse =
      s.reengajarAtivo === false
        ? []
        : (
            await this.leads.find({
              where: { status: LeadStatus.VENDA_PERDIDA, reengajadoEm: IsNull(), naoPerturbe: false } as any,
              order: { updatedAt: "ASC" },
              take: REENGAJAR_POR_HORA * 2, // sobra pra pular quem não tem telefone
            })
          ).filter(temTelefone);
    // Filas independentes: cada uma tem a sua metade da hora (a sobra de uma vai pra outra),
    // pra fila dos gestores não parar o reengajamento do Diretor (e vice-versa).
    const fila: any[] = dividirHora(daEquipe, semInteresse, REENGAJAR_POR_HORA);
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
          const equipe = l.filaEquipeId as string | undefined;
          // Lead da equipe: a conversa aparece pra quem é o dono (gestor, ou o corretor que já recebeu na planilha).
          if (equipe) await this.leads.query(`UPDATE conversations SET "assignedToId" = $1 WHERE id = $2`, [l.responsavelId || equipe, conv.id]).catch(() => null);
          const texto = (equipe ? mensagemPrimeiroContato : mensagemReengajar)(l.name, empreendimentoReal(l.empreendimento), i + new Date().getHours());
          await this.whatsapp.sendText(`user_${central}`, phone, texto);
          await this.conversations.addMessage(conv.id, texto, "out", true);
          await this.registrar(l, "enviado", undefined, equipe);
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
    if (lead?.filaEquipeId) return this.respostaDaEquipe(lead, texto, instancia, destino);
    const quando = (lead as any)?.reengajadoEm ? new Date((lead as any).reengajadoEm).getTime() : 0;
    if (!lead || lead.status !== LeadStatus.VENDA_PERDIDA || !quando || Date.now() - quando > 15 * 86_400_000) return false;
    // Palavras conhecidas primeiro; o que não der pra saber, a IA decide.
    let r = classificarResposta(texto);
    if (r === "outro") r = await this.ai.classificarInteresse(texto);
    if (r === "outro") return false;
    const nome = primeiroNome(lead.name);
    await this.registrar(lead, r, texto);
    if (r === "nao") return this.removerPorNao(lead, instancia, destino);
    await this.leads.update(lead.id, { status: LeadStatus.NOVO_LEAD } as any);
    await this.whatsapp
      .sendText(instancia, destino, `Que ótimo${nome ? `, ${nome}` : ""}! 😊 Já vou te colocar em contato com um especialista da Kayser.`)
      .catch(() => null);
    const f = await this.fila.distribuirLeadManual(lead.id).catch(() => null);
    this.logger.log(`Reengajamento: lead ${lead.id} tem interesse — fila: ${f?.status ?? "erro"}.`);
    return true;
  }

  /** Cliente disse NÃO: agradece, bloqueia o telefone e tira o lead do Kayser. */
  private async removerPorNao(lead: Lead, instancia: string, destino: string): Promise<boolean> {
    const nome = primeiroNome(lead.name);
    await this.whatsapp
      .sendText(instancia, destino, `Tudo bem${nome ? `, ${nome}` : ""}! Não vamos mais te enviar mensagens. Obrigado pela atenção 🙏`)
      .catch(() => null);
    await bloquearTelefones(this.leads.manager, lead.phone, lead.whatsapp).catch(() => null);
    await this.leads.remove(lead).catch((e) => this.logger.warn(`Reengajamento: não removi o lead ${lead.id} (${e.message}).`));
    this.logger.log(`Reengajamento: lead ${lead.id} disse NÃO — removido do Kayser.`);
    return true;
  }

  /**
   * Resposta de lead da Fila da Equipe. Sempre "tratado" (true): lead de equipe não cai na
   * fila central (com check-in) nem é atendido pela IA — é da equipe do gestor.
   * "sim" → rodízio entre os corretores da equipe (sem check-in); "não" → sai do Kayser;
   * outra coisa → fica com o gestor em Conversas ao vivo.
   */
  private async respostaDaEquipe(lead: Lead, texto: string, instancia: string, destino: string): Promise<boolean> {
    const chamadoEm = (lead as any).reengajadoEm ? new Date((lead as any).reengajadoEm).getTime() : 0;
    if (!chamadoEm) return true; // ainda não chamado
    const jaTratado = lead.transferidoPorId === lead.filaEquipeId && !!lead.transferidoEm && new Date(lead.transferidoEm).getTime() >= chamadoEm;
    if (jaTratado) return true; // já disse sim e foi pro corretor
    let r = classificarResposta(texto);
    if (r === "outro") r = await this.ai.classificarInteresse(texto);
    if (r === "outro") return true;
    await this.registrar(lead, r, texto, lead.filaEquipeId);
    if (r === "nao") return this.removerPorNao(lead, instancia, destino);
    const nome = primeiroNome(lead.name);
    // Planilha já repartida: o lead é do corretor — fica com ele, que recebe o aviso.
    if (lead.responsavelId && lead.responsavelId !== lead.filaEquipeId) {
      const dono: any[] = await this.leads.query(`SELECT name FROM users WHERE id::text = $1`, [lead.responsavelId]).catch(() => []);
      await this.leads.update(lead.id, { transferidoEm: new Date(), transferidoPorId: lead.filaEquipeId } as any);
      await this.whatsapp
        .sendText(instancia, destino, `Que ótimo${nome ? `, ${nome}` : ""}! 😊 Já vou te colocar em contato com ${dono[0]?.name ? `*${primeiroNome(dono[0].name)}*, ` : "um "}especialista da Kayser.`)
        .catch(() => null);
      // Aviso pro corretor: fogos na tela (transferidoEm) + e-mail, mesmo com o K1 fechado.
      await this.fila.notificarLeadPorEmail(lead.responsavelId).catch(() => null);
      this.logger.log(`Fila da Equipe: lead ${lead.id} disse SIM → segue com o corretor ${lead.responsavelId}.`);
      return true;
    }
    const corretor = await this.proximoDaEquipe(lead.filaEquipeId as string);
    if (!corretor) {
      await this.whatsapp.sendText(instancia, destino, `Que ótimo${nome ? `, ${nome}` : ""}! 😊 Já vou te colocar em contato com um especialista da Kayser.`).catch(() => null);
      this.logger.warn(`Fila da Equipe: gestor ${lead.filaEquipeId} sem corretor ativo — lead ${lead.id} ficou com o gestor.`);
      return true;
    }
    // Vai pro corretor com o aviso de fogos (transferidoEm) e a conversa junto.
    await this.leads.update(lead.id, { responsavelId: corretor.id, transferidoEm: new Date(), transferidoPorId: lead.filaEquipeId } as any);
    await this.leads.query(`UPDATE conversations SET "assignedToId" = $1 WHERE "leadId" = $2`, [corretor.id, lead.id]).catch(() => null);
    await this.whatsapp
      .sendText(instancia, destino, `Que ótimo${nome ? `, ${nome}` : ""}! 😊 Já vou te colocar em contato com *${primeiroNome(corretor.name)}*, especialista da Kayser.`)
      .catch(() => null);
    await this.fila.notificarLeadPorEmail(corretor.id).catch(() => null);
    this.logger.log(`Fila da Equipe: lead ${lead.id} disse SIM → corretor ${corretor.id}.`);
    return true;
  }

  /** Corretores ativos da equipe do gestor (ele + todos abaixo), por nome. */
  async corretoresDaEquipe(gestorId: string): Promise<{ id: string; name: string }[]> {
    return this.leads.query(
      `WITH RECURSIVE t AS (
         SELECT id::text AS id FROM users WHERE id::text = $1
         UNION SELECT u.id::text FROM users u JOIN t ON u."managerId"::text = t.id
       )
       SELECT u.id::text AS id, u.name FROM users u JOIN t ON t.id = u.id::text
        WHERE u.role = 'corretor' AND u.active = true AND u.approved = true AND u."empresaId" IS NULL
        ORDER BY u.name`,
      [gestorId]
    );
  }

  /** Próximo do rodízio da equipe: só os corretores que o gestor colocou (nenhum = fica com o gestor). */
  async proximoDaEquipe(gestorId: string): Promise<{ id: string; name: string } | null> {
    const time = await this.corretoresDaEquipe(gestorId);
    const [row] = await this.leads.query(`SELECT "memberIds", pointer FROM fila_equipe WHERE "gestorId" = $1`, [gestorId]);
    let escolhidos: string[] = [];
    try {
      escolhidos = (JSON.parse(row?.memberIds || "[]") as string[]).filter((id) => time.some((c) => c.id === id));
    } catch {
      escolhidos = [];
    }
    const roda = escolhidos;
    if (!roda.length) return null;
    const p = (Number(row?.pointer) || 0) % roda.length;
    await this.leads.query(
      `INSERT INTO fila_equipe ("gestorId", pointer) VALUES ($1, $2) ON CONFLICT ("gestorId") DO UPDATE SET pointer = $2`,
      [gestorId, p + 1]
    );
    return time.find((c) => c.id === roda[p]) ?? null;
  }

  /** Painel de uma Fila da Equipe: ligada?, corretores do rodízio e os números (só da equipe). */
  async painelEquipe(gestorId: string) {
    const hojeSP = `("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date`;
    const [row] = await this.leads.query(`SELECT "memberIds", ativo FROM fila_equipe WHERE "gestorId" = $1`, [gestorId]);
    let escolhidos: string[] = [];
    try {
      escolhidos = JSON.parse(row?.memberIds || "[]");
    } catch {
      escolhidos = [];
    }
    const time = await this.corretoresDaEquipe(gestorId);
    const [contagem] = await this.leads.query(
      `SELECT
         count(*) FILTER (WHERE tipo = 'enviado' AND ${hojeSP})::int AS "enviadosHoje",
         count(*) FILTER (WHERE tipo = 'sim' AND ${hojeSP})::int AS "simHoje",
         count(*) FILTER (WHERE tipo = 'nao' AND ${hojeSP})::int AS "naoHoje",
         count(*) FILTER (WHERE tipo = 'enviado')::int AS "enviadosTotal",
         count(*) FILTER (WHERE tipo = 'sim')::int AS "simTotal",
         count(*) FILTER (WHERE tipo = 'nao')::int AS "naoTotal"
       FROM reengajamento_eventos WHERE "filaEquipeId" = $1`,
      [gestorId]
    );
    const [fila] = await this.leads.query(
      `SELECT
         count(*) FILTER (WHERE "reengajadoEm" IS NOT NULL AND ("transferidoPorId" IS NULL OR "transferidoPorId"::text <> $1 OR "transferidoEm" < "reengajadoEm"))::int AS aguardando,
         count(*) FILTER (WHERE "reengajadoEm" IS NULL AND "naoPerturbe" = false)::int AS faltam
       FROM leads WHERE "filaEquipeId" = $1`,
      [gestorId]
    );
    const ultimas = await this.leads.query(
      `SELECT nome, tipo, texto, "createdAt" FROM reengajamento_eventos WHERE "filaEquipeId" = $1 AND tipo <> 'enviado' ORDER BY "createdAt" DESC LIMIT 40`,
      [gestorId]
    );
    return {
      gestorId,
      ativo: !!row?.ativo,
      corretores: time.map((c) => ({ ...c, noRodizio: escolhidos.includes(c.id) })),
      ...contagem,
      ...fila,
      ultimas,
    };
  }

  /** Gestor coloca/remove corretores do rodízio (só da equipe dele; vazio = ninguém recebe). */
  async salvarCorretores(gestorId: string, memberIds: string[]) {
    const time = await this.corretoresDaEquipe(gestorId);
    const validos = memberIds.filter((id) => time.some((c) => c.id === id));
    await this.leads.query(
      `INSERT INTO fila_equipe ("gestorId", "memberIds") VALUES ($1, $2) ON CONFLICT ("gestorId") DO UPDATE SET "memberIds" = $2`,
      [gestorId, JSON.stringify(validos)]
    );
    return this.painelEquipe(gestorId);
  }

  /** Só o Diretor liga/desliga a fila de um gestor. */
  async ligarFila(gestorId: string, ativo: boolean) {
    await this.leads.query(
      `INSERT INTO fila_equipe ("gestorId", ativo) VALUES ($1, $2) ON CONFLICT ("gestorId") DO UPDATE SET ativo = $2`,
      [gestorId, ativo]
    );
    return this.painelEquipe(gestorId);
  }

  /** Diretor: todas as filas de gestor (com lead na fila ou configurada). */
  async listarFilas() {
    return this.leads.query(
      `SELECT u.id::text AS "gestorId", u.name, u.role, COALESCE(f.ativo, false) AS ativo,
              (SELECT count(*)::int FROM leads l WHERE l."filaEquipeId" = u.id::text AND l."reengajadoEm" IS NULL AND l."naoPerturbe" = false) AS faltam,
              (SELECT count(*)::int FROM reengajamento_eventos e WHERE e."filaEquipeId" = u.id::text AND e.tipo = 'enviado') AS enviados,
              (SELECT count(*)::int FROM reengajamento_eventos e WHERE e."filaEquipeId" = u.id::text AND e.tipo = 'sim') AS sim,
              (SELECT count(*)::int FROM reengajamento_eventos e WHERE e."filaEquipeId" = u.id::text AND e.tipo = 'nao') AS nao
         FROM users u LEFT JOIN fila_equipe f ON f."gestorId" = u.id::text
        WHERE u.role IN ('superintendente', 'gerente_geral', 'gerente') AND u.active = true
        ORDER BY COALESCE(f.ativo, false) DESC, (SELECT count(*) FROM leads l WHERE l."filaEquipeId" = u.id::text) > 0 DESC, u.name` // ligadas e com planilha primeiro
    );
  }

  /** LGPD: depois de 90 dias o histórico fica só com a contagem (sem nome, telefone e texto). */
  @Cron("40 3 * * *", { timeZone: "America/Sao_Paulo" })
  async anonimizarEventosAntigos() {
    await this.leads
      .query(
        `UPDATE reengajamento_eventos SET nome = NULL, phone = NULL, texto = NULL
         WHERE "createdAt" < now() - interval '90 days' AND (nome IS NOT NULL OR phone IS NOT NULL OR texto IS NOT NULL)`
      )
      .catch((e) => this.logger.warn(`Reengajamento: anonimização LGPD falhou (${e.message}).`));
  }

  /** Guarda o que aconteceu (o lead do "não" é apagado, o histórico fica). */
  private async registrar(lead: Lead, tipo: "enviado" | "sim" | "nao", texto?: string, filaEquipeId?: string | null) {
    await this.leads
      .query(`INSERT INTO reengajamento_eventos ("leadId", nome, phone, tipo, texto, "filaEquipeId") VALUES ($1, $2, $3, $4, $5, $6)`, [
        lead.id,
        lead.name ?? null,
        lead.phone || lead.whatsapp || null,
        tipo,
        texto ? texto.slice(0, 500) : null,
        filaEquipeId ?? null,
      ])
      .catch((e) => this.logger.warn(`Reengajamento: não registrei evento (${e.message}).`));
  }

  /**
   * Relatório (Excel) do período: resumo por fila (Diretor e cada gestor) e todas as
   * respostas. Datas em AAAA-MM-DD no horário de Brasília (vazio = desde sempre / até hoje).
   */
  async relatorio(de?: string, ate?: string): Promise<Buffer> {
    const dia = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
    const params = [dia(de) ?? "2000-01-01", dia(ate) ?? "2999-12-31"];
    const dataSP = `(e."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')`;
    const periodo = `${dataSP}::date BETWEEN $1::date AND $2::date`;
    const nomeFila = `COALESCE('Fila de ' || trim(u.name), 'Fila do Diretor')`;
    const resumo: any[] = await this.leads.query(
      `SELECT ${nomeFila} AS fila,
              count(*) FILTER (WHERE e.tipo = 'enviado')::int AS chamados,
              count(*) FILTER (WHERE e.tipo = 'sim')::int AS sim,
              count(*) FILTER (WHERE e.tipo = 'nao')::int AS nao
         FROM reengajamento_eventos e LEFT JOIN users u ON u.id::text = e."filaEquipeId"
        WHERE ${periodo} GROUP BY 1`,
      params
    );
    const eventos: any[] = await this.leads.query(
      `SELECT to_char(${dataSP}, 'DD/MM/YYYY HH24:MI') AS data, ${nomeFila} AS fila, e.nome, e.phone, e.tipo, e.texto
         FROM reengajamento_eventos e LEFT JOIN users u ON u.id::text = e."filaEquipeId"
        WHERE ${periodo} ORDER BY e."createdAt" DESC`,
      params
    );
    // Total de leads de cada fila (hoje, sem filtro de data): planilha do gestor / "sem interesse" do Diretor.
    const totais: any[] = await this.leads.query(
      `SELECT COALESCE('Fila de ' || trim(u.name), 'Fila do Diretor') AS fila, count(*)::int AS total,
              count(*) FILTER (WHERE l."reengajadoEm" IS NULL AND l."naoPerturbe" = false)::int AS faltam
         FROM leads l LEFT JOIN users u ON u.id::text = l."filaEquipeId"
        WHERE l."filaEquipeId" IS NOT NULL OR l.status = $1
        GROUP BY 1`,
      [LeadStatus.VENDA_PERDIDA]
    );
    for (const t of totais) if (!resumo.some((r) => r.fila === t.fila)) resumo.push({ fila: t.fila, chamados: 0, sim: 0, nao: 0 });
    // Fila do Diretor primeiro, depois os gestores por nome.
    resumo.sort((a, b) => (a.fila === "Fila do Diretor" ? -1 : b.fila === "Fila do Diretor" ? 1 : String(a.fila).localeCompare(String(b.fila))));
    // Relatório no formato profissional: título, período, tabela, linha de TOTAL e taxa de "sim".
    const br = (s: string) => s.split("-").reverse().join("/");
    const titulo = [
      ["K1 — Relatório da IA (chamadas pelo WhatsApp)"],
      [`Período: ${br(params[0]) === "01/01/2000" ? "desde o início" : br(params[0])} a ${params[1].startsWith("2999") ? "hoje" : br(params[1])}`],
      [`Gerado em: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`],
      [],
    ];
    const taxa = (sim: number, chamados: number) => (chamados ? `${((sim / chamados) * 100).toFixed(1).replace(".", ",")}%` : "—");
    const linhas = resumo.map((r) => {
      const t = totais.find((x) => x.fila === r.fila);
      return [r.fila, t?.total ?? 0, t?.faltam ?? 0, r.chamados, r.sim, r.nao, taxa(r.sim, r.chamados)];
    });
    const soma = (i: number) => linhas.reduce((a, l) => a + (Number(l[i]) || 0), 0);
    const tot = ["TOTAL", soma(1), soma(2), soma(3), soma(4), soma(5), taxa(soma(4), soma(3))];
    const wb = XLSX.utils.book_new();
    const wsResumo = XLSX.utils.aoa_to_sheet([
      ...titulo,
      ["Fila", "Total de leads", "Faltam chamar", "Total de chamadas", "Total Sim", "Total Não", "% Sim"],
      ...linhas,
      [],
      tot,
    ]);
    wsResumo["!cols"] = [{ wch: 38 }, { wch: 15 }, { wch: 15 }, { wch: 18 }, { wch: 11 }, { wch: 11 }, { wch: 9 }];
    wsResumo["!merges"] = [0, 1, 2].map((r) => ({ s: { r, c: 0 }, e: { r, c: 6 } }));
    XLSX.utils.book_append_sheet(wb, wsResumo, "Resumo");
    // Uma aba por fila (Diretor e cada gestor): resumo dela no topo + cada cliente chamado e o que respondeu.
    const TIPO: Record<string, string> = { enviado: "Chamado", sim: "Sim", nao: "Não" };
    const usados = new Set<string>(["Resumo"]);
    linhas.forEach((l) => {
      const fila = String(l[0]);
      let aba = fila.replace(/[\\/?*[\]:]/g, "").slice(0, 31);
      while (usados.has(aba)) aba = aba.slice(0, 29) + usados.size;
      usados.add(aba);
      const ev = eventos.filter((e) => e.fila === fila);
      const ws = XLSX.utils.aoa_to_sheet([
        [fila],
        titulo[1],
        [],
        ["Total de leads", "Faltam chamar", "Total de chamadas", "Total Sim", "Total Não", "% Sim"],
        l.slice(1),
        [],
        ["Data", "Cliente", "Telefone", "Status", "Mensagem do cliente"],
        ...ev.map((e) => [e.data, e.nome ?? "", e.phone ?? "", TIPO[e.tipo] ?? e.tipo, e.texto ?? ""]),
      ]);
      ws["!cols"] = [{ wch: 17 }, { wch: 32 }, { wch: 16 }, { wch: 18 }, { wch: 60 }, { wch: 9 }];
      XLSX.utils.book_append_sheet(wb, ws, aba);
    });
    return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  }

  /** Painel do Diretor: números de hoje e do total, quem falta e as últimas respostas. */
  async painel() {
    const hojeSP = `("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date`;
    const [contagem] = await this.leads.query(
      `SELECT
         count(*) FILTER (WHERE tipo = 'enviado' AND ${hojeSP})::int AS "enviadosHoje",
         count(*) FILTER (WHERE tipo = 'sim' AND ${hojeSP})::int AS "simHoje",
         count(*) FILTER (WHERE tipo = 'nao' AND ${hojeSP})::int AS "naoHoje",
         count(*) FILTER (WHERE tipo = 'enviado')::int AS "enviadosTotal",
         count(*) FILTER (WHERE tipo = 'sim')::int AS "simTotal",
         count(*) FILTER (WHERE tipo = 'nao')::int AS "naoTotal"
       FROM reengajamento_eventos WHERE "filaEquipeId" IS NULL` // só a fila do Diretor — as dos gestores têm painel próprio
    );
    const [fila] = await this.leads.query(
      `SELECT
         count(*) FILTER (WHERE "reengajadoEm" IS NOT NULL AND "reengajadoEm" > now() - interval '15 days')::int AS aguardando,
         count(*) FILTER (WHERE "reengajadoEm" IS NULL AND "naoPerturbe" = false)::int AS faltam
       FROM leads WHERE status = $1`,
      [LeadStatus.VENDA_PERDIDA]
    );
    const ultimas = await this.leads.query(
      // Só a fila do Diretor — as respostas de cada gestor aparecem no quadro "IA por gestor".
      `SELECT nome, phone, tipo, texto, "createdAt" FROM reengajamento_eventos
        WHERE tipo <> 'enviado' AND "filaEquipeId" IS NULL ORDER BY "createdAt" DESC LIMIT 40`
    );
    const s: any = await this.settings.get().catch(() => null);
    return { ativo: s?.reengajarAtivo !== false, porHora: REENGAJAR_POR_HORA, ...contagem, ...fila, ultimas };
  }
}
