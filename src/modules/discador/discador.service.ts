import { ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { Lead, LeadStatus } from "../leads/lead.entity";
import { User, UserRole } from "../users/user.entity";
import { UsersService } from "../users/users.service";
import { SettingsService } from "../settings/settings.service";
import { ConversationsService } from "../conversations/conversations.service";
import { WhatsappService } from "../whatsapp/whatsapp.service";
import { LeadHistoryService } from "../lead-history/lead-history.service";
import { LeadHistoryType } from "../lead-history/lead-history.entity";
import { comCodigoBrasil } from "../../common/telefone";
import { ehGestor } from "../kanban/kanban.service";

/** Resultado de uma ligação do Discador (24/11). */
export const RESULTADOS = ["atendeu", "nao_atendeu", "caixa_postal", "ocupado", "numero_invalido"] as const;
export type Resultado = (typeof RESULTADOS)[number];

/** Não atendeu / caixa postal → K1 manda WhatsApp (não deixa recado na caixa postal). */
export const vaiProWhatsapp = (r: string) => r === "nao_atendeu" || r === "caixa_postal";

export const mensagemNaoAtendeu = (cliente: string, corretor: string) => {
  const c = (cliente || "").trim().split(/\s+/)[0];
  const k = (corretor || "").trim().split(/\s+/)[0];
  return `Oi${c ? ` ${c}` : ""}, tudo bem? Aqui é ${k ? `${k}, ` : ""}da Kayser. Tentei te ligar agora há pouco 📞 Posso falar com você por aqui?`;
};

const hojeSP = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const lista = (s?: string | null) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);

/**
 * Discador do K1 (24/11): o próprio K1 liga pelos 3 números virtuais, o corretor fala
 * pelo K1 (fone de ouvido). Atendeu → corretor de plantão com check-in; não atendeu /
 * caixa postal → WhatsApp. A telefonia (Twilio) entra quando as chaves estiverem coladas;
 * até lá o corretor registra o resultado à mão e os indicadores já contam.
 */
@Injectable()
export class DiscadorService {
  private readonly logger = new Logger(DiscadorService.name);

  constructor(
    @InjectRepository(Lead) private readonly leads: Repository<Lead>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly usersService: UsersService,
    private readonly settings: SettingsService,
    private readonly conversations: ConversationsService,
    private readonly whatsapp: WhatsappService,
    private readonly history: LeadHistoryService
  ) {}

  private async cfg() {
    const s: any = await this.settings.get().catch(() => null);
    return { ligado: !!s?.discadorLigado, corretores: lista(s?.discadorCorretores), numeros: lista(s?.discadorNumeros) };
  }

  /** Quem fez check-in no plantão hoje e não saiu do stand. */
  private async comCheckin(): Promise<Set<string>> {
    // ponytail: ignora a exceção do plantão da noite (pode sair do stand); usar PlantaoService.idsDoTurno se precisar.
    const rows: { id: string }[] = await this.leads
      .query(`SELECT DISTINCT "userId"::text AS id FROM plantao_checkins WHERE data = $1 AND "saiuEm" IS NULL`, [hojeSP()])
      .catch(() => []);
    return new Set(rows.map((r) => r.id));
  }

  async painel(user: User) {
    const { ligado, corretores, numeros } = await this.cfg();
    const escopo = await this.usersService.getScopeIds(user); // null = Diretor (tudo)
    const gestor = ehGestor(user);
    const ck = await this.comCheckin();
    const equipe = gestor
      ? (await this.users.find({ where: { role: UserRole.CORRETOR, active: true } as any, order: { name: "ASC" } }))
          .filter((u) => !u.empresaId && (!escopo || escopo.includes(u.id)))
          .map((u) => ({ id: u.id, nome: u.name, incluido: corretores.includes(u.id), checkin: ck.has(u.id) }))
      : [];
    const filtro = escopo ? `AND d."userId" = ANY($2)` : "";
    const params: any[] = escopo ? [hojeSP(), escopo] : [hojeSP()];
    const hoje = `(d."createdAt" AT TIME ZONE 'America/Sao_Paulo')::date = $1::date`;
    const porCorretor: any[] = await this.leads
      .query(
        `SELECT u.name AS nome, count(*)::int AS feitas,
                count(*) FILTER (WHERE d.resultado = 'atendeu')::int AS atendidas,
                count(*) FILTER (WHERE d.resultado = 'nao_atendeu')::int AS "naoAtendidas",
                count(*) FILTER (WHERE d.resultado = 'caixa_postal')::int AS "caixaPostal",
                count(*) FILTER (WHERE d."whatsappEnviado")::int AS whatsapp,
                COALESCE(round(avg(d."duracaoSeg") FILTER (WHERE d.resultado = 'atendeu')), 0)::int AS "duracaoMedia"
           FROM discador_ligacoes d LEFT JOIN users u ON u.id::text = d."userId"
          WHERE ${hoje} ${filtro}
          GROUP BY u.name ORDER BY feitas DESC`,
        params
      )
      .catch(() => []);
    const soma = (k: string) => porCorretor.reduce((a, r) => a + Number(r[k] || 0), 0);
    const feitas = soma("feitas");
    const ultimas: any[] = await this.leads
      .query(
        `SELECT d.id, d.resultado, d."duracaoSeg", d.anotacao, d."whatsappEnviado", d."createdAt",
                l.name AS lead, u.name AS corretor
           FROM discador_ligacoes d LEFT JOIN leads l ON l.id::text = d."leadId" LEFT JOIN users u ON u.id::text = d."userId"
          WHERE ${hoje} ${filtro} ORDER BY d."createdAt" DESC LIMIT 30`,
        params
      )
      .catch(() => []);
    return {
      ligado,
      numeros,
      telefoniaConectada: !!process.env.TWILIO_ACCOUNT_SID,
      podeGerir: gestor,
      ehDiretor: user.role === UserRole.DIRETOR,
      euIncluido: corretores.includes(user.id),
      euCheckin: ck.has(user.id),
      equipe,
      indicadores: {
        feitas,
        atendidas: soma("atendidas"),
        naoAtendidas: soma("naoAtendidas"),
        caixaPostal: soma("caixaPostal"),
        whatsapp: soma("whatsapp"),
        taxa: feitas ? Math.round((soma("atendidas") / feitas) * 100) : 0,
      },
      porCorretor,
      ultimas,
      proximos: await this.proximos(user, escopo),
    };
  }

  /** Leads pra ligar: os do escopo em Novo Lead / Primeiro Contato, do mais antigo pro mais novo. */
  private async proximos(user: User, escopo: string[] | null) {
    const where: any = { status: In([LeadStatus.NOVO_LEAD, LeadStatus.PRIMEIRO_CONTATO]), naoPerturbe: false };
    if (escopo) where.responsavelId = user.role === UserRole.CORRETOR ? user.id : In(escopo);
    const ls = await this.leads.find({ where, order: { etapaDesde: "ASC" } as any, take: 20 }).catch(() => [] as Lead[]);
    return ls
      .filter((l) => l.phone || l.whatsapp)
      .map((l) => ({ id: l.id, nome: l.name, telefone: l.phone || l.whatsapp, empreendimento: l.empreendimento || "", status: l.status }));
  }

  async definirLigado(ligado: boolean) {
    await this.settings.update({ discadorLigado: ligado } as any);
    return { ligado };
  }

  async definirNumeros(numeros: string[]) {
    const limpos = numeros.map((n) => n.replace(/[^\d+]/g, "")).filter(Boolean).slice(0, 3);
    await this.settings.update({ discadorNumeros: limpos.join(",") || null } as any);
    return { numeros: limpos };
  }

  /** Incluir/remover corretor do Discador (gestor só a própria equipe). */
  async definirCorretor(user: User, alvoId: string, incluido: boolean) {
    const escopo = await this.usersService.getScopeIds(user);
    if (escopo && !escopo.includes(alvoId)) throw new ForbiddenException("Esse corretor não é da sua equipe.");
    const set = new Set((await this.cfg()).corretores);
    if (incluido) set.add(alvoId);
    else set.delete(alvoId);
    await this.settings.update({ discadorCorretores: [...set].join(",") || null } as any);
    return { incluido };
  }

  /** Registra uma ligação; não atendeu / caixa postal → WhatsApp automático. */
  async registrar(user: User, dto: { leadId: string; resultado: Resultado; duracaoSeg?: number; anotacao?: string }) {
    const lead = await this.leads.findOne({ where: { id: dto.leadId } });
    if (!lead) throw new NotFoundException("Lead não encontrado.");
    const escopo = await this.usersService.getScopeIds(user);
    if (escopo && lead.responsavelId && !escopo.includes(lead.responsavelId))
      throw new ForbiddenException("Esse lead não é seu nem da sua equipe.");
    let whatsappEnviado = false;
    if (vaiProWhatsapp(dto.resultado) && !(lead as any).naoPerturbe) whatsappEnviado = await this.mandarWhatsapp(lead, user);
    const [row] = await this.leads.query(
      `INSERT INTO discador_ligacoes ("leadId", "userId", resultado, "duracaoSeg", anotacao, "whatsappEnviado")
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [lead.id, user.id, dto.resultado, dto.duracaoSeg ?? null, dto.anotacao?.trim() || null, whatsappEnviado]
    );
    const nomes: Record<string, string> = {
      atendeu: "atendeu",
      nao_atendeu: "não atendeu",
      caixa_postal: "caiu na caixa postal",
      ocupado: "deu ocupado",
      numero_invalido: "número inválido",
    };
    await this.history
      .log({
        leadId: lead.id,
        type: LeadHistoryType.CONTATO,
        userId: user.id,
        description:
          `📞 Discador: ${user.name} ligou — ${nomes[dto.resultado]}.` +
          (whatsappEnviado ? " WhatsApp enviado." : "") +
          (dto.anotacao?.trim() ? ` Anotação: ${dto.anotacao.trim()}` : ""),
      })
      .catch(() => {});
    return { id: row?.id, whatsappEnviado };
  }

  /** Anotação escrita depois (durante/após a ligação). */
  async anotar(user: User, id: string, anotacao: string) {
    const r = await this.leads.query(`UPDATE discador_ligacoes SET anotacao = $1 WHERE id = $2 AND "userId" = $3 RETURNING "leadId"`, [
      anotacao.trim() || null,
      id,
      user.id,
    ]);
    const leadId = (Array.isArray(r[0]) ? r[0][0] : r[0])?.leadId;
    if (!leadId) throw new NotFoundException("Ligação não encontrada.");
    if (anotacao.trim())
      await this.history.log({ leadId, type: LeadHistoryType.NOTA, userId: user.id, description: `📞 Anotação da ligação: ${anotacao.trim()}` }).catch(() => {});
    return { ok: true };
  }

  private async mandarWhatsapp(lead: Lead, user: User): Promise<boolean> {
    const tel = lead.phone || lead.whatsapp;
    if (!tel) return false;
    try {
      const central = await this.conversations.diretorCentralId();
      if (!central) return false;
      const phone = comCodigoBrasil(tel);
      const conv = await this.conversations.findOrCreateByPhone(phone, central);
      if (!conv.leadId) await this.conversations.setLead(conv.id, lead.id, lead.name).catch(() => null);
      const texto = mensagemNaoAtendeu(lead.name, user.name);
      await this.whatsapp.sendText(`user_${central}`, phone, texto);
      await this.conversations.addMessage(conv.id, texto, "out" as any, true);
      return true;
    } catch (e) {
      this.logger.warn(`Discador: WhatsApp falhou pro lead ${lead.id} (${(e as Error).message}).`);
      return false;
    }
  }
}
