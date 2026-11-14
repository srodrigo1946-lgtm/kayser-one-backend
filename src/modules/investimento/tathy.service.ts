import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Cron } from "@nestjs/schedule";
import { ConfigService } from "@nestjs/config";
import { Repository } from "typeorm";
import axios from "axios";
import { AnuncioDia } from "./anuncio-dia.entity";
import { TathyMensagem } from "./tathy-mensagem.entity";
import { AiService } from "../ai/ai.service";

/**
 * Lê um link pra Tathy analisar: só http(s) de site público (nada de IP/localhost), 10 s,
 * até 2 MB; devolve título, descrição e o texto da página (sem scripts).
 */
export async function lerLink(url: string): Promise<string> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "Link inválido.";
  }
  const host = u.hostname.toLowerCase();
  if (!/^https?:$/.test(u.protocol) || host === "localhost" || /\.(local|internal)$/.test(host) || /^[\d.]+$/.test(host) || host.includes(":")) {
    return "Por segurança só leio links de sites públicos (endereço com nome, http/https).";
  }
  try {
    const { data } = await axios.get(u.toString(), {
      timeout: 10_000,
      maxContentLength: 2_000_000,
      maxRedirects: 3,
      responseType: "text",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; KayserOne-Tathy/1.0)", "Accept-Language": "pt-BR" },
    });
    const html = String(data);
    const meta = (p: string) => html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']*)`, "i"))?.[1] ?? "";
    const titulo = html.match(/<title[^>]*>([^<]*)/i)?.[1]?.trim() ?? "";
    const texto = html
      .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 6000);
    return [`Título: ${titulo || meta("og:title")}`, `Descrição: ${meta("og:description") || meta("description")}`, `Texto: ${texto}`].join("\n");
  } catch (err: any) {
    return `Não consegui abrir o link (${err?.response?.status ?? err?.code ?? err?.message}). Se for do Facebook/Instagram, ele pede login: mande um print.`;
  }
}
import { InvestimentoService } from "./investimento.service";
import { SettingsService } from "../settings/settings.service";
import { brl as brlOuTraco, montarApresentacao, montarPlanilha } from "./tathy-relatorio";

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
  // Volume mínimo: 1.000 impressões e (7 dias rodando OU 15 resultados) antes de julgar.
  if (a.impressoes < 1000 || ((a.dias ?? 0) < 7 && a.conversoes < 15)) {
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
  // Formulário/pixel + anúncio de clique pro WhatsApp (conversa iniciada = o lead que chega no K1).
  const tipos = [
    "lead",
    "onsite_conversion.lead_grouped",
    "offsite_conversion.fb_pixel_lead",
    "onsite_conversion.messaging_conversation_started_7d",
  ];
  return Math.max(0, ...(actions ?? []).filter((a) => tipos.includes(a.action_type)).map((a) => Number(a.value) || 0));
}

@Injectable()
export class TathyService {
  private readonly logger = new Logger(TathyService.name);

  constructor(
    @InjectRepository(AnuncioDia) private readonly anuncios: Repository<AnuncioDia>,
    @InjectRepository(TathyMensagem) private readonly mensagens: Repository<TathyMensagem>,
    private readonly ai: AiService,
    private readonly investimento: InvestimentoService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService
  ) {}

  private async gravar(linhas: Partial<AnuncioDia>[]) {
    if (!linhas.length) return;
    // Anúncios com o mesmo nome no mesmo dia (outra campanha/conta) viram uma linha só —
    // senão o Postgres recusa ("ON CONFLICT ... cannot affect row a second time").
    const soma = new Map<string, Partial<AnuncioDia>>();
    for (const l of linhas) {
      const k = `${l.canal}|${l.data}|${l.anuncio}`;
      const a = soma.get(k);
      if (!a) soma.set(k, { ...l });
      else {
        a.gasto = Number(a.gasto) + Number(l.gasto || 0);
        a.cliques = Number(a.cliques) + Number(l.cliques || 0);
        a.impressoes = Number(a.impressoes) + Number(l.impressoes || 0);
        a.conversoes = Number(a.conversoes) + Number(l.conversoes || 0);
      }
    }
    await this.anuncios.upsert([...soma.values()] as any, ["canal", "data", "anuncio"]);
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

  /** Histórico da conversa com a Tathy (as últimas 60). */
  async conversa(userId: string) {
    const rows = await this.mensagens.find({ where: { userId }, order: { createdAt: "DESC" }, take: 60 });
    return rows.reverse().map((m) => ({ role: m.role, texto: m.texto, imagens: m.imagens, links: m.links ? m.links.split("\n") : [], em: m.createdAt }));
  }

  async limparConversa(userId: string) {
    await this.mensagens.delete({ userId });
    return { ok: true };
  }

  /**
   * Pergunte à Tathy (14/11): responde na hora com os números AO VIVO do painel, lê imagens
   * (criativo/print) e links (anúncio/página). Tudo gravado. Sincera, rápida, solução primeiro.
   */
  async perguntar(userId: string, body: { pergunta?: string; imagens?: { mime: string; base64: string }[] }) {
    const pergunta = String(body?.pergunta ?? "").trim().slice(0, 4000);
    const imagens = (Array.isArray(body?.imagens) ? body.imagens : [])
      .filter((i) => /^image\/(png|jpe?g|webp|gif)$/.test(String(i?.mime)) && typeof i?.base64 === "string" && i.base64.length < 7_000_000)
      .slice(0, 4)
      .map((i) => ({ mime: i.mime === "image/jpg" ? "image/jpeg" : i.mime, base64: i.base64 }));
    if (!pergunta && !imagens.length) return { resposta: "Escreva sua pergunta ou mande uma imagem." };
    const links = [...new Set(pergunta.match(/https?:\/\/[^\s<>"')]+/g) ?? [])].slice(0, 3);

    const hojeSP = new Date(Date.now() - 3 * 3600_000);
    const painel = await this.painel(hojeSP.getUTCFullYear(), hojeSP.getUTCMonth() + 1);
    const lidos = await Promise.all(links.map(async (l) => `### ${l}\n${await lerLink(l)}`));
    const historico = (await this.mensagens.find({ where: { userId }, order: { createdAt: "DESC" }, take: 12 }))
      .reverse()
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.texto }));

    const resumo = {
      atualizadoEm: painel.atualizadoEm,
      canais: painel.canais,
      alertas: painel.alertas,
      anuncios: painel.anuncios,
      funil: painel.funil,
      comQuem: painel.porResponsavel.slice(0, 30),
      ranking: painel.rankingCorretores.slice(0, 20),
      maisParados: painel.parados.slice(0, 15),
      paraDistribuir: painel.paraDistribuir.slice(0, 20),
      semInteresse: painel.semInteresse.slice(0, 25),
    };
    const system = `Você é a Tathy, gestora de tráfego do Kayser One (imobiliária no Rio de Janeiro, lançamentos e imóveis prontos).
Fala com o Rodrigo, Diretor. Responda SEMPRE em português do Brasil.

Jeito de trabalhar (regra do Rodrigo):
- Seja SINCERA: se está ruim, diga que está ruim e por quê. Nada de enrolar ou elogiar à toa.
- Seja RÁPIDA e PRÁTICA: comece pela solução/ação, depois o motivo em 1–2 linhas. Respostas curtas, em tópicos.
- Toda ação com valor em reais (ex.: "tire R$ 30/dia do anúncio X"), nunca só porcentagem.
- Use os números AO VIVO abaixo. Nunca invente número; se não tiver o dado, diga qual falta e onde pegar.
- REGRA: só leads de anúncio (Meta e Google Ads separados). Lead do Google = vitrine imoveis.kayserone.com.br.
- Critérios de gestor de tráfego: compare com a média do próprio canal; pouco volume = não dá veredito; CTR bom e sem lead = problema na página/oferta, não no anúncio; um anúncio com mais de 70% dos leads deixa o canal frágil.
- Imagem (criativo/print): diga o que funciona e o que trocar (gancho, preço, bairro, chamada, legibilidade no celular, logo de terceiros) e proponha 2 ou 3 títulos/textos prontos.
- Link: analise o que foi lido; se a página não abriu (ex.: Facebook pede login), diga isso e peça um print.
- Você não executa ações sozinha no Meta/Google: diga exatamente onde clicar. No K1, aponte o botão (ex.: gaveta "Leads para distribuir" → "Fila do plantão").

Números ao vivo do painel (JSON):
${JSON.stringify(resumo).slice(0, 60000)}
${lidos.length ? `\nConteúdo dos links enviados:\n${lidos.join("\n\n")}` : ""}`;

    let resposta: string;
    try {
      resposta = (await this.ai.perguntarComImagens(system, historico, pergunta || "Analise a imagem.", imagens)) || "(sem resposta)";
    } catch (err: any) {
      resposta = `Não consegui responder agora: ${err?.response?.message ?? err?.message ?? "erro na IA"}`;
    }
    await this.mensagens.save([
      this.mensagens.create({ userId, role: "user", texto: pergunta || "(imagem)", imagens: imagens.length, links: links.join("\n") || null }),
      this.mensagens.create({ userId, role: "assistant", texto: resposta }),
    ]);
    return { resposta, links, imagens: imagens.length };
  }

  /** Números dos últimos 7 dias (até ontem) por canal — pro relatório de segunda. */
  async semana(): Promise<{ inicio: Date; fim: Date; porCanal: Record<string, { gasto: number; leads: number; semInteresse: number }> }> {
    const db = this.anuncios.manager;
    const hojeSP = new Date(Date.now() - 3 * 3600_000);
    const fim = new Date(Date.UTC(hojeSP.getUTCFullYear(), hojeSP.getUTCMonth(), hojeSP.getUTCDate())); // exclusivo
    const inicio = new Date(fim.getTime() - 7 * 86_400_000);
    const ini = inicio.toISOString().slice(0, 10);
    const fimIso = fim.toISOString().slice(0, 10);
    const leads: any[] = await db.query(
      `SELECT ${CANAL_SQL} AS canal,
         count(*) FILTER (WHERE (l."createdAt" - interval '3 hours')::date >= $1 AND (l."createdAt" - interval '3 hours')::date < $2)::int AS leads,
         count(*) FILTER (WHERE (l."perdaEm" - interval '3 hours')::date >= $1 AND (l."perdaEm" - interval '3 hours')::date < $2)::int AS "semInteresse"
       FROM leads l WHERE ${SO_ANUNCIO_SQL} GROUP BY 1`,
      [ini, fimIso]
    );
    const [meta]: any[] = await db.query(
      `SELECT COALESCE(sum(valor), 0)::float AS gasto FROM ad_investment_days
       WHERE make_date(ano, mes, dia) >= $1::date AND make_date(ano, mes, dia) < $2::date`,
      [ini, fimIso]
    );
    const [google]: any[] = await db.query(
      `SELECT COALESCE(sum(gasto), 0)::float AS gasto FROM anuncio_dias WHERE canal = 'google' AND data >= $1 AND data < $2`,
      [ini, fimIso]
    );
    const porCanal: Record<string, { gasto: number; leads: number; semInteresse: number }> = {};
    for (const c of ["meta", "google"]) {
      const r = leads.find((x) => x.canal === c);
      porCanal[c] = { gasto: c === "meta" ? meta.gasto : google.gasto, leads: r?.leads ?? 0, semInteresse: r?.semInteresse ?? 0 };
    }
    return { inicio, fim: new Date(fim.getTime() - 86_400_000), porCanal };
  }

  /** Monta a apresentação (PDF) da semana. */
  async apresentacao(): Promise<{ pdf: Uint8Array; planilha: Buffer; inicio: string; fim: string; painel: any; semana: any }> {
    const hojeSP = new Date(Date.now() - 3 * 3600_000);
    const ano = hojeSP.getUTCFullYear();
    const mes = hojeSP.getUTCMonth() + 1;
    const painel = await this.painel(ano, mes);
    const sem = await this.semana();
    const dm = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
    const inicio = dm(sem.inicio);
    const fim = dm(sem.fim);
    const dados = { inicio, fim, mesNome: MESES[mes - 1], semana: sem.porCanal, painel };
    const pdf = await montarApresentacao(dados);
    const planilha = montarPlanilha(dados);
    return { pdf, planilha, inicio, fim, painel, semana: sem.porCanal };
  }

  /** Manda a apresentação por e-mail (Resend) — segunda 9h e pelo botão "Enviar agora". */
  async enviarRelatorio(para = process.env.TATHY_EMAIL || "srodrigo1946@gmail.com"): Promise<{ ok: boolean; para: string; erro?: string }> {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return { ok: false, para, erro: "RESEND_API_KEY não configurado no servidor." };
    const { pdf, planilha, inicio, fim, painel, semana } = await this.apresentacao();
    const c = painel.canais;
    const tot = (k: string) => (Number(c.meta[k]) || 0) + (Number(c.google[k]) || 0);
    const linha = (rot: string, m: string, g: string) =>
      `<tr><td style="padding:6px 12px;color:#a59b8a">${rot}</td><td style="padding:6px 12px;text-align:right">${m}</td><td style="padding:6px 12px;text-align:right">${g}</td></tr>`;
    const corretores = (painel.porResponsavel ?? []).filter((r: any) => r.cargo === "corretor").reduce((a: number, r: any) => a + r.leads, 0);
    const gestores = (painel.porResponsavel ?? []).filter((r: any) => r.cargo !== "corretor").reduce((a: number, r: any) => a + r.leads, 0);
    const html = `<div style="font-family:Arial,sans-serif;background:#0b0a08;color:#f4ede0;padding:24px;border-radius:12px">
      <div style="color:#d9ad55;font-weight:bold">Tathy · gestora de tráfego</div>
      <h2 style="margin:6px 0 4px">Relatório semanal de tráfego e leads</h2>
      <div style="color:#a59b8a">Semana de ${inicio} a ${fim} · só leads de anúncio · apresentação completa em PDF no anexo</div>
      <table style="margin-top:16px;border-collapse:collapse;color:#f4ede0;font-size:14px">
        <tr><td></td><td style="padding:6px 12px;color:#3b82f6;text-align:right"><b>Meta</b></td><td style="padding:6px 12px;color:#22c55e;text-align:right"><b>Google Ads</b></td></tr>
        ${linha("Investido na semana", brlOuTraco(semana.meta.gasto), brlOuTraco(semana.google.gasto))}
        ${linha("Leads na semana", String(semana.meta.leads), String(semana.google.leads))}
        ${linha("Custo por lead (mês)", brlOuTraco(c.meta.cpl), brlOuTraco(c.google.cpl))}
        ${linha("Vendas no mês", String(c.meta.vendas), String(c.google.vendas))}
      </table>
      <p style="margin-top:16px">Leads de anúncio em aberto: <b>${corretores + gestores}</b> · com corretor <b>${corretores}</b> · com gerente/Diretor/sem dono <b style="color:#f59e0b">${gestores}</b>.</p>
      <p>Investimento total no mês: <b>${brlOuTraco(tot("gasto"))}</b> · ${tot("leads")} leads.</p>
      <ul>${(painel.alertas ?? []).slice(0, 4).map((a: any) => `<li>${a.texto}</li>`).join("")}</ul>
      <div style="color:#a59b8a;font-size:12px;margin-top:16px">Enviado automaticamente toda segunda às 9h pelo Kayser One.</div>
    </div>`;
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: process.env.SUPPORT_FROM || "K1 <onboarding@resend.dev>",
          to: para,
          subject: `Relatório de tráfego e leads — semana ${inicio} a ${fim}`,
          html,
          attachments: [
            { filename: `Apresentacao-trafego-${inicio.replace("/", "-")}-a-${fim.replace("/", "-")}.pdf`, content: Buffer.from(pdf).toString("base64") },
            { filename: `Ranking-e-numeros-${inicio.replace("/", "-")}-a-${fim.replace("/", "-")}.xlsx`, content: Buffer.from(planilha).toString("base64") },
          ],
        }),
      });
      if (!r.ok) return { ok: false, para, erro: `Resend recusou (${r.status}): ${(await r.text()).slice(0, 200)}` };
      this.logger.log(`Relatório da Tathy enviado para ${para} (${inicio}–${fim}).`);
      return { ok: true, para };
    } catch (err: any) {
      return { ok: false, para, erro: err.message };
    }
  }

  @Cron("0 9 * * 1", { timeZone: "America/Sao_Paulo" })
  async relatorioSegunda() {
    const r = await this.enviarRelatorio().catch((err) => ({ ok: false, erro: err.message }));
    if (!r.ok) this.logger.warn(`Relatório de segunda da Tathy falhou: ${(r as any).erro}`);
  }

  /** Painel completo da aba Custo por Lead (calculado na hora = tempo real). */
  async painel(ano: number, mes: number) {
    const db = this.anuncios.manager;
    const pad = (n: number) => String(n).padStart(2, "0");
    const ini = `${ano}-${pad(mes)}-01`;
    const fim = `${ano}-${pad(mes)}-${pad(new Date(ano, mes, 0).getDate())}`;
    const hoje = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
    // "Hoje" só existe no mês atual (em Outubro não pode mostrar o gasto do dia 13 de Outubro).
    const mesAtual = hoje.slice(0, 7) === `${ano}-${pad(mes)}`;

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
    const metaHoje = mesAtual ? (await this.investimento.getDays(ano, mes)).find((d) => d.dia === Number(hoje.slice(8, 10)))?.valor ?? 0 : 0;
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
        gastoHoje: !mesAtual ? 0 : c === "meta" ? metaHoje : g[0].hoje,
        leads: r.leads,
        leadsHoje: mesAtual ? r.leadsHoje : 0,
        cpl: r.leads && gasto > 0 ? gasto / r.leads : null, // sem gasto = "—", não "R$ 0"
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

    // Leads de anúncio ABERTOS parados com gerente/Diretor ou sem dono → pra distribuir (com nome).
    const paraDistribuir: any[] = await db.query(
      `SELECT l.id, l.name AS nome, ${CANAL_SQL} AS canal, COALESCE(k.title, l.status::text) AS etapa,
         round((EXTRACT(EPOCH FROM now() - COALESCE(l."etapaDesde", l."createdAt")) / 86400)::numeric, 1)::float AS dias,
         u.name AS responsavel, u.role AS cargo
       FROM leads l
       LEFT JOIN users u ON u.id = l."responsavelId"
       LEFT JOIN kanban_columns k ON k.key = l.status::text
       WHERE ${SO_ANUNCIO_SQL} AND l.status::text NOT IN ${FECHADOS} AND (u.id IS NULL OR u.role <> 'corretor')
       ORDER BY COALESCE(l."etapaDesde", l."createdAt") ASC LIMIT 100`
    );

    // Com quem estão os leads de anúncio ABERTOS: por pessoa (corretor x gerente) — regra do relatório.
    const porResponsavel: any[] = await db.query(
      `SELECT COALESCE(u.name, 'Sem dono') AS nome, COALESCE(u.role::text, 'sem_dono') AS cargo,
         count(*)::int AS leads,
         count(*) FILTER (WHERE ${CANAL_SQL} = 'meta')::int AS meta,
         count(*) FILTER (WHERE ${CANAL_SQL} = 'google')::int AS google,
         round(avg(EXTRACT(EPOCH FROM now() - COALESCE(l."etapaDesde", l."createdAt")) / 86400)::numeric, 1)::float AS "diasMedio"
       FROM leads l LEFT JOIN users u ON u.id = l."responsavelId"
       WHERE ${SO_ANUNCIO_SQL} AND l.status::text NOT IN ${FECHADOS}
       GROUP BY 1, 2 ORDER BY 3 DESC`
    );

    // RANKING dos corretores (regra 13/11): leads de anúncio recebidos no mês e o que cada um fez,
    // com porcentagens. "Sem interesse" conta pro corretor que tinha o lead (perdaCorretorId).
    const rankingCorretores: any[] = await db.query(
      `WITH base AS (
         SELECT l.status::text AS status, l."etapaDesde", l."createdAt", ${CANAL_SQL} AS canal,
                COALESCE(CASE WHEN ur.role::text = 'corretor' THEN l."responsavelId"::text END, l."perdaCorretorId") AS cid
         FROM leads l LEFT JOIN users ur ON ur.id = l."responsavelId"
         WHERE ${SO_ANUNCIO_SQL} AND l."createdAt"::date BETWEEN $1 AND $2
       )
       SELECT u.name AS nome,
         count(*)::int AS recebidos,
         count(*) FILTER (WHERE b.canal = 'meta')::int AS meta,
         count(*) FILTER (WHERE b.canal = 'google')::int AS google,
         count(*) FILTER (WHERE b.status NOT IN ${FECHADOS})::int AS abertos,
         count(*) FILTER (WHERE b.status IN ('agendamento','visita_agendada'))::int AS agendamentos,
         count(*) FILTER (WHERE b.status IN ('visita_realizada','simulacao','subida_pasta','aprovacao','reprovacao','venda_ganha'))::int AS visitas,
         count(*) FILTER (WHERE b.status = 'venda_ganha')::int AS vendas,
         count(*) FILTER (WHERE b.status = 'venda_perdida')::int AS "semInteresse",
         COALESCE(round(avg(EXTRACT(EPOCH FROM now() - COALESCE(b."etapaDesde", b."createdAt")) / 86400)
           FILTER (WHERE b.status NOT IN ${FECHADOS})::numeric, 1), 0)::float AS "diasParado"
       FROM base b JOIN users u ON u.id::text = b.cid
       GROUP BY u.name
       ORDER BY 8 DESC, 7 DESC, 6 DESC, 2 DESC`,
      [ini, fim]
    );
    rankingCorretores.forEach((r, i) => {
      const pc = (n: number) => (r.recebidos ? Math.round((n / r.recebidos) * 1000) / 10 : 0);
      Object.assign(r, {
        posicao: i + 1,
        pctAgendamento: pc(r.agendamentos + r.visitas),
        pctVisita: pc(r.visitas),
        pctVenda: pc(r.vendas),
        pctSemInteresse: pc(r.semInteresse),
      });
    });

    // "Sem interesse" do mês: motivo, de quem era, quem marcou (só o Diretor vê esta tela).
    const semInteresse: any[] = await db.query(
      `SELECT l.id, l.name AS nome, ${CANAL_SQL} AS canal, l."perdaMotivo" AS motivo, l."perdaEm" AS em,
         c.name AS corretor, p.name AS "marcadoPor"
       FROM leads l
       LEFT JOIN users c ON c.id::text = l."perdaCorretorId"
       LEFT JOIN users p ON p.id::text = l."perdaPorId"
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

    return { atualizadoEm: new Date().toISOString(), mesAtual, canais, funil, parados, paraDistribuir, porResponsavel, rankingCorretores, semInteresse, ranking, anuncios, alertas };
  }
}
