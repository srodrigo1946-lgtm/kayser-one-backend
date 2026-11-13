import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Cron } from "@nestjs/schedule";
import { ConfigService } from "@nestjs/config";
import { Repository } from "typeorm";
import axios from "axios";
import { AnuncioDia } from "./anuncio-dia.entity";
import { InvestimentoService } from "./investimento.service";
import { SettingsService } from "../settings/settings.service";

const GRAPH = "https://graph.facebook.com/v26.0";

/**
 * Tathy — gestora de tráfego (Rodrigo 13/11). REGRA: só leads de ANÚNCIO.
 * Google Ads = leads da vitrine (campanha "Vitrine…"); Meta = anúncio / formulário Meta.
 */
export const CANAL_SQL = `CASE WHEN l.campanha ILIKE 'Vitrine%' THEN 'google'
  WHEN l.source::text IN ('anuncio','formulario_meta') THEN 'meta' END`;
export const SO_ANUNCIO_SQL = `(l.campanha ILIKE 'Vitrine%' OR l.source::text IN ('anuncio','formulario_meta'))`;
const FECHADOS = `('venda_ganha','venda_perdida')`;

// Critérios de gestor de tráfego (skill ad-manager): Bom / Atenção / Problema / Sem veredito,
// sempre contra a média do PRÓPRIO canal (não benchmark da internet) e com volume mínimo.
export type Nota = "bom" | "atencao" | "problema" | "sem_veredito";
export interface AnuncioResumo {
  canal: string;
  anuncio: string;
  campanha?: string | null;
  gasto: number;
  cliques: number;
  impressoes: number;
  conversoes: number;
  /** Dias com entrega no mês. */
  dias?: number;
  /** Dias seguidos (até hoje) gastando sem nenhum resultado. */
  diasSemResultado?: number;
}

const brl = (v: number) => `R$ ${Math.round(v).toLocaleString("pt-BR")}`;
const pct = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")}%`;

/** Nota de um anúncio no mês e o que fazer (sempre com o valor em reais). */
export function avaliarAnuncio(a: AnuncioResumo, cplMedio: number): { nota: Nota; dica: string; cpl: number | null; ctr: number | null } {
  const ctr = a.impressoes > 0 ? a.cliques / a.impressoes : null;
  const cpl = a.conversoes > 0 ? a.gasto / a.conversoes : null;
  // Gastando 14+ dias sem resultado = problema, mesmo com pouco volume.
  if ((a.diasSemResultado ?? 0) >= 14 && a.gasto > 0) {
    return { nota: "problema", dica: `Gastou ${brl(a.gasto)} em ${a.diasSemResultado} dias sem nenhum lead. Pausar e trocar o criativo — economiza esse valor por mês.`, cpl, ctr };
  }
  // Volume mínimo: 7 dias rodando e 1.000 impressões antes de julgar.
  if ((a.dias ?? 0) < 7 || a.impressoes < 1000) {
    return { nota: "sem_veredito", dica: `Ainda aprendendo (${a.dias ?? 0} dia(s), ${a.impressoes.toLocaleString("pt-BR")} impressões). Preciso de 7 dias e 1.000 impressões para julgar.`, cpl, ctr };
  }
  // CTR bom e nenhum lead: o anúncio funciona, o problema é a página/oferta.
  if (!cpl && ctr !== null && ctr >= 0.02) {
    return { nota: "atencao", dica: `As pessoas clicam (CTR ${pct(ctr)}) mas não viram lead. O anúncio está bom — o problema é a página ou a oferta. Não mexa no criativo; revise o formulário/vitrine.`, cpl, ctr };
  }
  if (!cpl) {
    return { nota: "problema", dica: `Gastou ${brl(a.gasto)} sem lead e com pouco clique${ctr !== null ? ` (CTR ${pct(ctr)})` : ""}. Trocar foto e título (preço + bairro + Black Friday).`, cpl, ctr };
  }
  const desvio = cplMedio ? cpl / cplMedio - 1 : 0;
  if (desvio > 0.4) {
    return { nota: "problema", dica: `Lead a ${brl(cpl)}, ${Math.round(desvio * 100)}% acima da média do canal (${brl(cplMedio)}). Tirar verba daqui ou trocar o criativo.`, cpl, ctr };
  }
  if (desvio > 0.15 || (ctr !== null && ctr < 0.01)) {
    return { nota: "atencao", dica: ctr !== null && ctr < 0.01
      ? `Pouca gente clica (CTR ${pct(ctr)}): sinal de criativo cansado. Testar nova imagem antes de pôr mais dinheiro.`
      : `Lead a ${brl(cpl)}, ${Math.round(desvio * 100)}% acima da média (${brl(cplMedio)}). Testar uma variação do criativo.`, cpl, ctr };
  }
  return { nota: "bom", dica: `Lead a ${brl(cpl)}${cplMedio ? ` (média ${brl(cplMedio)})` : ""}. Está funcionando — pode receber mais verba enquanto o custo não subir.`, cpl, ctr };
}

export interface DadosAlerta {
  canais: Record<string, {
    gasto: number; leads: number; gastoHoje: number; leadsHoje: number; semInteresse: number; temDados: boolean;
    leadsPlataforma?: number; concentracao?: number;
  }>;
  novoParado24h: number;
  comGestor: number;
  anunciosRuins: number;
}

/** Avisos da Tathy em tempo real (ordem = prioridade). */
export function alertasTathy(d: DadosAlerta): { nivel: "critico" | "atencao" | "ok"; texto: string }[] {
  const out: { nivel: "critico" | "atencao" | "ok"; texto: string }[] = [];
  const nome: Record<string, string> = { meta: "Meta", google: "Google Ads" };
  for (const [canal, c] of Object.entries(d.canais)) {
    const cpl = c.leads ? c.gasto / c.leads : 0;
    if (c.gastoHoje > 0 && c.leadsHoje === 0 && cpl && c.gastoHoje >= cpl) {
      out.push({ nivel: "critico", texto: `${nome[canal]}: hoje já gastou ${brl(c.gastoHoje)} e não veio nenhum lead. Confira o anúncio.` });
    }
    if (c.leads >= 5 && c.semInteresse / c.leads > 0.3) {
      out.push({ nivel: "atencao", texto: `${nome[canal]}: ${Math.round((c.semInteresse / c.leads) * 100)}% dos leads do mês viraram "sem interesse". Pode ser público errado no anúncio.` });
    }
    // Plataforma x K1: sempre vão diferir — mostrar os dois e dizer qual usar.
    if ((c.leadsPlataforma ?? 0) >= 5 && c.leads < 0.7 * (c.leadsPlataforma ?? 0)) {
      out.push({ nivel: "atencao", texto: `${nome[canal]} diz ${c.leadsPlataforma} leads no mês; no K1 chegaram ${c.leads}. Guie-se pelo K1 (lead real). Se a diferença crescer, confira o formulário/integração.` });
    }
    if ((c.concentracao ?? 0) > 0.7) {
      out.push({ nivel: "atencao", texto: `${nome[canal]}: um único anúncio traz ${Math.round((c.concentracao ?? 0) * 100)}% dos leads. Se ele cansar, o canal para — já prepare um segundo criativo.` });
    }
    if (canal === "google" && !c.temDados) {
      out.push({ nivel: "atencao", texto: "Google Ads ainda não mandou os números dos anúncios. Cole o script da Tathy no Google Ads (Ferramentas → Scripts)." });
    }
  }
  if (d.novoParado24h > 0) out.push({ nivel: "critico", texto: `${d.novoParado24h} lead(s) de anúncio em "Novo Lead" há mais de 1 dia sem atendimento.` });
  if (d.comGestor > 0) out.push({ nivel: "atencao", texto: `${d.comGestor} lead(s) de anúncio aberto(s) parado(s) com gerente/Diretor — não foram para corretor.` });
  if (d.anunciosRuins > 0) out.push({ nivel: "atencao", texto: `${d.anunciosRuins} anúncio(s) com "Problema" — veja abaixo o que trocar no criativo.` });
  if (!out.length) out.push({ nivel: "ok", texto: "Tudo dentro do esperado agora. Sigo de olho." });
  return out;
}

/** Leads de cada ação do Meta (lead do formulário / pixel). */
export function leadsDasAcoes(actions: { action_type: string; value: string }[] | undefined): number {
  const tipos = ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"];
  return Math.max(0, ...(actions ?? []).filter((a) => tipos.includes(a.action_type)).map((a) => Number(a.value) || 0));
}

@Injectable()
export class TathyService {
  private readonly logger = new Logger(TathyService.name);

  constructor(
    @InjectRepository(AnuncioDia) private readonly anuncios: Repository<AnuncioDia>,
    private readonly investimento: InvestimentoService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService
  ) {}

  private async gravar(linhas: Partial<AnuncioDia>[]) {
    if (!linhas.length) return;
    await this.anuncios.upsert(linhas as any, ["canal", "data", "anuncio"]);
  }

  /** Meta: resultado de cada anúncio por dia no mês (de hora em hora junto com o gasto). */
  async sincronizarAnunciosMeta(ano: number, mes: number): Promise<number> {
    const s: any = await this.settings.get().catch(() => null);
    const token: string = s?.metaPageToken || this.config.get<string>("META_PAGE_ACCESS_TOKEN") || "";
    const contas = String(s?.metaAdAccountIds || "").split(",").map((x) => x.trim().replace(/^act_/, "")).filter(Boolean);
    if (!token || !contas.length) return 0;
    const pad = (n: number) => String(n).padStart(2, "0");
    const since = `${ano}-${pad(mes)}-01`;
    const until = `${ano}-${pad(mes)}-${pad(new Date(ano, mes, 0).getDate())}`;
    const linhas: Partial<AnuncioDia>[] = [];
    for (const conta of contas) {
      let url: string | null = `${GRAPH}/act_${conta}/insights`;
      let params: any = {
        access_token: token,
        level: "ad",
        fields: "ad_name,campaign_name,spend,clicks,impressions,actions",
        time_increment: 1,
        time_range: JSON.stringify({ since, until }),
        limit: 200,
      };
      for (let p = 0; url && p < 10; p++) {
        const { data }: any = await axios.get(url, { params });
        for (const r of data?.data ?? []) {
          linhas.push({
            canal: "meta",
            data: String(r.date_start).slice(0, 10),
            anuncio: String(r.ad_name || "Anúncio sem nome").slice(0, 300),
            campanha: r.campaign_name ? String(r.campaign_name).slice(0, 300) : null,
            gasto: Number(r.spend) || 0,
            cliques: Number(r.clicks) || 0,
            impressoes: Number(r.impressions) || 0,
            conversoes: leadsDasAcoes(r.actions),
          });
        }
        url = data?.paging?.next ?? null;
        params = undefined;
      }
    }
    await this.gravar(linhas);
    return linhas.length;
  }

  @Cron("12 * * * *", { timeZone: "America/Sao_Paulo" })
  async sincronizarAnunciosMetaAutomatico() {
    const agora = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    await this.sincronizarAnunciosMeta(agora.getFullYear(), agora.getMonth() + 1).catch((err) =>
      this.logger.warn(`Anúncios do Meta (Tathy) falhou: ${err?.response?.data?.error?.message ?? err.message}`)
    );
  }

  /** Google Ads: o script colado na conta empurra os anúncios por dia (protegido pelo Verify Token). */
  async receberGoogle(token: string, body: any): Promise<{ ok: boolean; linhas?: number }> {
    const s: any = await this.settings.get().catch(() => null);
    const esperado = s?.metaVerifyToken || this.config.get<string>("META_VERIFY_TOKEN") || "";
    if (!esperado || token !== esperado) return { ok: false };
    const linhas: Partial<AnuncioDia>[] = (Array.isArray(body?.linhas) ? body.linhas : [])
      .slice(0, 5000)
      .filter((r: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(r?.data)) && r?.anuncio)
      .map((r: any) => ({
        canal: "google",
        data: String(r.data),
        anuncio: String(r.anuncio).slice(0, 300),
        campanha: r.campanha ? String(r.campanha).slice(0, 300) : null,
        gasto: Number(r.gasto) || 0,
        cliques: Number(r.cliques) || 0,
        impressoes: Number(r.impressoes) || 0,
        conversoes: Number(r.conversoes) || 0,
      }));
    await this.gravar(linhas);
    return { ok: true, linhas: linhas.length };
  }

  /** Painel completo da aba Custo por Lead (calculado na hora = tempo real). */
  async painel(ano: number, mes: number) {
    const db = this.anuncios.manager;
    const pad = (n: number) => String(n).padStart(2, "0");
    const ini = `${ano}-${pad(mes)}-01`;
    const fim = `${ano}-${pad(mes)}-${pad(new Date(ano, mes, 0).getDate())}`;
    const hoje = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

    // Leads, vendas e "sem interesse" do mês por canal.
    const porCanal: any[] = await db.query(
      `SELECT ${CANAL_SQL} AS canal,
         count(*) FILTER (WHERE l."createdAt"::date BETWEEN $1 AND $2)::int AS leads,
         count(*) FILTER (WHERE (l."createdAt" - interval '3 hours')::date = $3)::int AS "leadsHoje",
         count(*) FILTER (WHERE l.status::text = 'venda_ganha' AND l."dataVenda" BETWEEN $1 AND $2)::int AS vendas,
         COALESCE(sum(l."valorVenda") FILTER (WHERE l.status::text = 'venda_ganha' AND l."dataVenda" BETWEEN $1 AND $2), 0)::float AS vgv,
         count(*) FILTER (WHERE l."perdaEm"::date BETWEEN $1 AND $2)::int AS "semInteresse"
       FROM leads l WHERE ${SO_ANUNCIO_SQL} GROUP BY 1`,
      [ini, fim, hoje]
    );
    // Gasto: Meta = gasto por dia já existente; Google = soma dos anúncios do script.
    const metaGasto = (await this.investimento.get(ano, mes)).valor;
    const metaHoje = (await this.investimento.getDays(ano, mes)).find((d) => d.dia === Number(hoje.slice(8, 10)))?.valor ?? 0;
    const g: any[] = await db.query(
      `SELECT COALESCE(sum(gasto),0)::float AS gasto, COALESCE(sum(gasto) FILTER (WHERE data = $3),0)::float AS hoje, count(*)::int AS n
       FROM anuncio_dias WHERE canal = 'google' AND data BETWEEN $1 AND $2`,
      [ini, fim, hoje]
    );
    const canais: Record<string, any> = {};
    for (const c of ["meta", "google"]) {
      const r = porCanal.find((x) => x.canal === c) ?? { leads: 0, leadsHoje: 0, vendas: 0, vgv: 0, semInteresse: 0 };
      const gasto = c === "meta" ? metaGasto : g[0].gasto;
      canais[c] = {
        gasto,
        gastoHoje: c === "meta" ? metaHoje : g[0].hoje,
        leads: r.leads,
        leadsHoje: r.leadsHoje,
        cpl: r.leads ? gasto / r.leads : null,
        vendas: r.vendas,
        vgv: r.vgv,
        custoVenda: r.vendas ? gasto / r.vendas : null,
        semInteresse: r.semInteresse,
        temDados: c === "meta" ? true : g[0].n > 0,
      };
    }

    // Funil: TODOS os leads de anúncio (varredura), por etapa, tempo parado e com quem estão.
    const funil: any[] = await db.query(
      `SELECT ${CANAL_SQL} AS canal, l.status::text AS etapa, COALESCE(k.title, l.status::text) AS titulo, COALESCE(k.position, 99) AS pos,
         count(*)::int AS total,
         count(*) FILTER (WHERE u.role = 'corretor')::int AS "comCorretor",
         count(*) FILTER (WHERE u.role IS NOT NULL AND u.role <> 'corretor')::int AS "comGestor",
         count(*) FILTER (WHERE u.id IS NULL)::int AS "semDono",
         COALESCE(round(avg(EXTRACT(EPOCH FROM now() - COALESCE(l."etapaDesde", l."createdAt")) / 86400)::numeric, 1), 0)::float AS "diasMedio",
         COALESCE(round(max(EXTRACT(EPOCH FROM now() - COALESCE(l."etapaDesde", l."createdAt")) / 86400)::numeric, 1), 0)::float AS "diasMax"
       FROM leads l
       LEFT JOIN users u ON u.id = l."responsavelId"
       LEFT JOIN kanban_columns k ON k.key = l.status::text
       WHERE ${SO_ANUNCIO_SQL}
       GROUP BY 1, 2, 3, 4 ORDER BY 1, 4`
    );

    // Mais parados (abertos), pra cobrar quem está com eles.
    const parados: any[] = await db.query(
      `SELECT l.id, l.name AS nome, ${CANAL_SQL} AS canal, COALESCE(k.title, l.status::text) AS etapa,
         round((EXTRACT(EPOCH FROM now() - COALESCE(l."etapaDesde", l."createdAt")) / 86400)::numeric, 1)::float AS dias,
         u.name AS responsavel, u.role AS cargo
       FROM leads l
       LEFT JOIN users u ON u.id = l."responsavelId"
       LEFT JOIN kanban_columns k ON k.key = l.status::text
       WHERE ${SO_ANUNCIO_SQL} AND l.status::text NOT IN ${FECHADOS}
       ORDER BY COALESCE(l."etapaDesde", l."createdAt") ASC LIMIT 25`
    );
    const [extra]: any[] = await db.query(
      `SELECT count(*) FILTER (WHERE l.status::text = 'novo_lead' AND COALESCE(l."etapaDesde", l."createdAt") < now() - interval '24 hours')::int AS "novoParado24h",
              count(*) FILTER (WHERE u.role IS NOT NULL AND u.role <> 'corretor')::int AS "comGestor"
       FROM leads l LEFT JOIN users u ON u.id = l."responsavelId"
       WHERE ${SO_ANUNCIO_SQL} AND l.status::text NOT IN ${FECHADOS}`
    );

    // "Sem interesse" do mês: motivo, de quem era, quem marcou (só o Diretor vê esta tela).
    const semInteresse: any[] = await db.query(
      `SELECT l.id, l.name AS nome, ${CANAL_SQL} AS canal, l."perdaMotivo" AS motivo, l."perdaEm" AS em,
         c.name AS corretor, p.name AS "marcadoPor"
       FROM leads l
       LEFT JOIN users c ON c.id = l."perdaCorretorId"
       LEFT JOIN users p ON p.id = l."perdaPorId"
       WHERE ${SO_ANUNCIO_SQL} AND l."perdaEm"::date BETWEEN $1 AND $2
       ORDER BY l."perdaEm" DESC LIMIT 100`,
      [ini, fim]
    );
    const porCorretor: Record<string, { nome: string; total: number; semMotivo: number }> = {};
    for (const r of semInteresse) {
      const k = r.corretor || "Sem corretor";
      porCorretor[k] = porCorretor[k] || { nome: k, total: 0, semMotivo: 0 };
      porCorretor[k].total++;
      if (!r.motivo) porCorretor[k].semMotivo++;
    }
    const ranking = Object.values(porCorretor).sort((a, b) => b.total - a.total);

    // Anúncios do mês com nota da Tathy.
    const anunciosMes: any[] = await db.query(
      `SELECT canal, anuncio, max(campanha) AS campanha, sum(gasto)::float AS gasto, sum(cliques)::int AS cliques,
              sum(impressoes)::int AS impressoes, sum(conversoes)::float AS conversoes,
              count(DISTINCT data) FILTER (WHERE gasto > 0)::int AS dias,
              (CASE WHEN max(data) FILTER (WHERE conversoes > 0) IS NULL THEN count(DISTINCT data) FILTER (WHERE gasto > 0)
                    ELSE max(data) FILTER (WHERE gasto > 0) - max(data) FILTER (WHERE conversoes > 0) END)::int AS "diasSemResultado"
       FROM anuncio_dias WHERE data BETWEEN $1 AND $2 GROUP BY canal, anuncio ORDER BY sum(gasto) DESC LIMIT 60`,
      [ini, fim]
    );
    // Média de custo por resultado de cada canal pelos números da própria plataforma.
    for (const c of ["meta", "google"]) {
      const lista = anunciosMes.filter((a) => a.canal === c);
      const conv = lista.reduce((s, a) => s + (a.conversoes || 0), 0);
      const gastoAn = lista.reduce((s, a) => s + (a.gasto || 0), 0);
      canais[c].leadsPlataforma = conv;
      canais[c].cplPlataforma = conv ? gastoAn / conv : null;
      // Concentração: um anúncio com mais de 70% dos resultados deixa o canal frágil.
      const top = lista.reduce((m, a) => Math.max(m, a.conversoes || 0), 0);
      canais[c].concentracao = conv >= 5 ? top / conv : 0;
    }
    const anuncios = anunciosMes.map((a) => ({ ...a, ...avaliarAnuncio(a, canais[a.canal]?.cplPlataforma ?? 0) }));

    const alertas = alertasTathy({
      canais: { meta: canais.meta, google: canais.google },
      novoParado24h: extra?.novoParado24h ?? 0,
      comGestor: extra?.comGestor ?? 0,
      anunciosRuins: anuncios.filter((a) => a.nota === "problema").length,
    });

    return { atualizadoEm: new Date().toISOString(), canais, funil, parados, semInteresse, ranking, anuncios, alertas };
  }
}
