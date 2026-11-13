import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import * as XLSX from "xlsx";

/**
 * Planilha do relatório (regra 13/11): RANKING com porcentagens e todos os números,
 * + Meta x Google, com quem estão os leads, parados, anúncios e sem interesse.
 */
export function montarPlanilha(d: DadosRelatorio): Buffer {
  const P = d.painel;
  const wb = XLSX.utils.book_new();
  const aba = (nome: string, linhas: Record<string, unknown>[], larguras: number[]) => {
    const ws = XLSX.utils.json_to_sheet(linhas.length ? linhas : [{ Aviso: "Sem dados no período" }]);
    ws["!cols"] = larguras.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, nome);
  };
  const pct = (n: number) => Math.round(n * 10) / 10;
  const canal = (c: string) => (c === "google" ? "Google Ads" : "Meta");

  aba(
    "Ranking corretores",
    (P.rankingCorretores ?? []).map((r: any) => ({
      Troféu: ["🏆 1º lugar", "🥈 2º lugar", "🥉 3º lugar"][r.posicao - 1] ?? "",
      Posição: r.posicao,
      Corretor: r.nome,
      "Leads recebidos": r.recebidos,
      "Do Meta": r.meta,
      "Do Google": r.google,
      "Em aberto": r.abertos,
      "Agendamentos + visitas": r.agendamentos + r.visitas,
      "% agendamento": pct(r.pctAgendamento),
      Visitas: r.visitas,
      "% visita": pct(r.pctVisita),
      Vendas: r.vendas,
      "% conversão em venda": pct(r.pctVenda),
      "Sem interesse": r.semInteresse,
      "% sem interesse": pct(r.pctSemInteresse),
      "Parado em média (dias)": r.diasParado,
    })),
    [13, 9, 34, 15, 9, 10, 10, 20, 14, 9, 10, 8, 20, 13, 15, 20]
  );
  const linhaCanal = (rot: string, fn: (c: string) => unknown) => ({ Indicador: rot, Meta: fn("meta"), "Google Ads": fn("google") });
  aba(
    "Meta x Google",
    [
      linhaCanal("Investimento no mês (R$)", (c) => Math.round(P.canais[c].gasto)),
      linhaCanal("Leads no K1 no mês", (c) => P.canais[c].leads),
      linhaCanal("Leads segundo a plataforma", (c) => Math.round(P.canais[c].leadsPlataforma || 0)),
      linhaCanal("Custo por lead (R$)", (c) => (P.canais[c].cpl != null ? Math.round(P.canais[c].cpl * 100) / 100 : "")),
      linhaCanal("Vendas no mês", (c) => P.canais[c].vendas),
      linhaCanal("Custo por venda (R$)", (c) => (P.canais[c].custoVenda != null ? Math.round(P.canais[c].custoVenda) : "")),
      linhaCanal("Sem interesse no mês", (c) => P.canais[c].semInteresse),
      linhaCanal("Investido na semana (R$)", (c) => Math.round(d.semana[c]?.gasto ?? 0)),
      linhaCanal("Leads na semana", (c) => d.semana[c]?.leads ?? 0),
    ],
    [30, 14, 14]
  );
  const totalAberto = (P.porResponsavel ?? []).reduce((a: number, r: any) => a + r.leads, 0) || 1;
  aba(
    "Com quem estão",
    (P.porResponsavel ?? []).map((r: any) => ({
      Pessoa: r.nome,
      Tipo: r.cargo === "corretor" ? "Corretor" : r.cargo === "sem_dono" ? "Sem dono" : "Gerente / Diretor",
      Cargo: r.cargo,
      "Leads em aberto": r.leads,
      "% do total": pct((r.leads / totalAberto) * 100),
      "Do Meta": r.meta,
      "Do Google": r.google,
      "Parado em média (dias)": r.diasMedio,
    })),
    [34, 18, 16, 15, 11, 9, 10, 20]
  );
  aba(
    "Leads parados",
    (P.parados ?? []).map((p: any) => ({ Lead: p.nome, Canal: canal(p.canal), Etapa: p.etapa, "Parado (dias)": p.dias, "Com quem": p.responsavel ?? "Sem dono", Cargo: p.cargo ?? "" })),
    [32, 12, 22, 13, 30, 14]
  );
  aba(
    "Anúncios",
    (P.anuncios ?? []).map((a: any) => ({
      Canal: canal(a.canal),
      Anúncio: a.anuncio,
      Nota: ({ bom: "Bom", atencao: "Atenção", problema: "Problema", sem_veredito: "Aprendendo" } as Record<string, string>)[a.nota] ?? a.nota,
      "Gasto (R$)": Math.round(a.gasto),
      Impressões: a.impressoes,
      Cliques: a.cliques,
      "CTR %": a.ctr != null ? pct(a.ctr * 100) : "",
      Leads: Math.round(a.conversoes),
      "Custo por lead (R$)": a.cpl != null ? Math.round(a.cpl * 100) / 100 : "",
      "O que fazer": a.dica,
    })),
    [11, 40, 12, 11, 12, 9, 8, 8, 17, 80]
  );
  aba(
    "Sem interesse",
    (P.semInteresse ?? []).map((s: any) => ({
      Data: s.em ? new Date(s.em).toLocaleDateString("pt-BR") : "",
      Lead: s.nome,
      Canal: canal(s.canal),
      Corretor: s.corretor ?? "",
      "Marcado por": s.marcadoPor ?? "",
      Motivo: s.motivo ?? "sem justificativa (antes da regra)",
    })),
    [11, 30, 12, 28, 26, 70]
  );
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/**
 * Apresentação semanal da Tathy (Rodrigo 13/11): slides 16:9 preto e dourado pra ele levar
 * ao superior. Só leads de ANÚNCIO, Google Ads x Meta separados.
 */
const W = 960;
const H = 540;
const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const C = {
  fundo: hex("#0b0a08"),
  painel: hex("#17140f"),
  linha: hex("#2e271c"),
  ouro: hex("#d9ad55"),
  ouroClaro: hex("#f1d38f"),
  texto: hex("#f4ede0"),
  cinza: hex("#a59b8a"),
  meta: hex("#3b82f6"),
  google: hex("#22c55e"),
  vermelho: hex("#ef4444"),
  ambar: hex("#f59e0b"),
};
const CANAL_COR: Record<string, ReturnType<typeof rgb>> = { meta: C.meta, google: C.google };
const CANAL_NOME: Record<string, string> = { meta: "Meta", google: "Google Ads" };
const NOTA: Record<string, [string, ReturnType<typeof rgb>]> = {
  bom: ["BOM", C.google],
  atencao: ["ATENÇÃO", C.ambar],
  problema: ["PROBLEMA", C.vermelho],
  sem_veredito: ["APRENDENDO", C.cinza],
};

export const brl = (v?: number | null) =>
  v == null ? "—" : `R$ ${Math.round(v).toLocaleString("pt-BR")}`;
const diasTxt = (d: number) => (d < 1 ? `${Math.round(d * 24)}h` : `${d.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} dias`);

/** Helvetica (WinAnsi) não tem emoji nem setas: troca/tira o que não imprime. */
export function limpar(s: unknown): string {
  return String(s ?? "")
    .replace(/→/g, "->")
    .replace(/[≥]/g, ">=")
    .replace(/[^\x20-\xFF—–“”‘’•…€]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface DadosRelatorio {
  inicio: string; // dd/mm
  fim: string;
  mesNome: string;
  semana: Record<string, { gasto: number; leads: number; semInteresse: number }>;
  painel: any; // retorno de TathyService.painel
}

class Slide {
  constructor(public p: PDFPage, private f: PDFFont, private b: PDFFont) {}
  txt(t: unknown, x: number, y: number, size = 14, cor = C.texto, bold = false) {
    this.p.drawText(limpar(t), { x, y: H - y, size, font: bold ? this.b : this.f, color: cor });
  }
  largura(t: unknown, size: number, bold = false) {
    return (bold ? this.b : this.f).widthOfTextAtSize(limpar(t), size);
  }
  txtDir(t: unknown, xDir: number, y: number, size = 14, cor = C.texto, bold = false) {
    this.txt(t, xDir - this.largura(t, size, bold), y, size, cor, bold);
  }
  /** Quebra o texto na largura; devolve o y final. */
  paragrafo(t: unknown, x: number, y: number, larg: number, size = 13, cor = C.texto, maxLinhas = 6, bold = false): number {
    const palavras = limpar(t).split(" ");
    let linha = "";
    let n = 0;
    for (const w of palavras) {
      const teste = linha ? `${linha} ${w}` : w;
      if (this.largura(teste, size, bold) > larg && linha) {
        this.txt(linha, x, y, size, cor, bold);
        y += size * 1.35;
        linha = w;
        if (++n >= maxLinhas - 1) {
          linha = linha + "…";
          break;
        }
      } else linha = teste;
    }
    if (linha) {
      this.txt(linha, x, y, size, cor, bold);
      y += size * 1.35;
    }
    return y;
  }
  ret(x: number, y: number, w: number, h: number, cor = C.painel, borda?: ReturnType<typeof rgb>) {
    this.p.drawRectangle({ x, y: H - y - h, width: w, height: h, color: cor, ...(borda ? { borderColor: borda, borderWidth: 1 } : {}) });
  }
  /** Troféu desenhado (a fonte do PDF não tem emoji). (cx, topo) = centro do topo da taça; t = altura. */
  trofeu(cx: number, topo: number, t: number, cor = C.ouro) {
    const p = this.p;
    const y = (v: number) => H - v;
    const w = t * 0.62;
    // alças
    p.drawEllipse({ x: cx - w / 2, y: y(topo + t * 0.2), xScale: t * 0.16, yScale: t * 0.14, borderColor: cor, borderWidth: t * 0.05 });
    p.drawEllipse({ x: cx + w / 2, y: y(topo + t * 0.2), xScale: t * 0.16, yScale: t * 0.14, borderColor: cor, borderWidth: t * 0.05 });
    // taça
    p.drawRectangle({ x: cx - w / 2, y: y(topo + t * 0.3), width: w, height: t * 0.3, color: cor });
    p.drawEllipse({ x: cx, y: y(topo + t * 0.3), xScale: w / 2, yScale: t * 0.26, color: cor });
    // brilho
    p.drawRectangle({ x: cx - w * 0.3, y: y(topo + t * 0.42), width: w * 0.1, height: t * 0.34, color: C.ouroClaro, opacity: 0.6 });
    // haste e base
    p.drawRectangle({ x: cx - t * 0.06, y: y(topo + t * 0.78), width: t * 0.12, height: t * 0.24, color: cor });
    p.drawRectangle({ x: cx - t * 0.26, y: y(topo + t * 0.9), width: t * 0.52, height: t * 0.12, color: cor });
    p.drawRectangle({ x: cx - t * 0.34, y: y(topo + t), width: t * 0.68, height: t * 0.1, color: cor });
  }
  /** Medalha redonda com a posição. */
  medalha(cx: number, cy: number, r: number, cor: ReturnType<typeof rgb>, n: number) {
    this.p.drawCircle({ x: cx, y: H - cy, size: r, color: cor });
    this.p.drawCircle({ x: cx, y: H - cy, size: r * 0.78, borderColor: C.fundo, borderWidth: 1, opacity: 0 });
    const txt = String(n);
    const tam = r * 1.1;
    this.txt(txt, cx - this.largura(txt, tam, true) / 2, cy + tam * 0.36, tam, C.fundo, true);
  }
  cabecalho(titulo: string, sub: string, n: number, total: number) {
    this.ret(0, 0, W, H, C.fundo);
    this.ret(0, 0, 8, H, C.ouro);
    this.txt(titulo, 48, 64, 30, C.texto, true);
    this.txt(sub, 48, 90, 13, C.cinza);
    this.txtDir(`Kayser · Tathy, gestora de tráfego   ${n}/${total}`, W - 40, H - 22, 9, C.cinza);
  }
}

export async function montarApresentacao(d: DadosRelatorio): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Relatório de tráfego e leads — ${d.inicio} a ${d.fim}`);
  pdf.setAuthor("Tathy · Kayser One");
  const f = await pdf.embedFont(StandardFonts.Helvetica);
  const b = await pdf.embedFont(StandardFonts.HelveticaBold);
  const P = d.painel;
  const TOTAL = 11;
  const nova = () => new Slide(pdf.addPage([W, H]), f, b);
  const canais = ["meta", "google"];
  const tot = (k: string) => canais.reduce((s, c) => s + (Number(P.canais[c]?.[k]) || 0), 0);
  const semTot = (k: "gasto" | "leads" | "semInteresse") => canais.reduce((s, c) => s + (d.semana[c]?.[k] || 0), 0);

  // 1. Capa
  {
    const s = nova();
    s.ret(0, 0, W, H, C.fundo);
    s.ret(0, 0, W, 6, C.ouro);
    s.ret(64, 150, 64, 64, C.ouro);
    s.txt("K", 84, 196, 40, C.fundo, true);
    s.txt("Relatório semanal de", 64, 280, 40, C.texto, true);
    s.txt("tráfego e leads", 64, 328, 40, C.ouroClaro, true);
    s.txt(`Semana de ${d.inicio} a ${d.fim} · acumulado de ${d.mesNome}`, 64, 372, 16, C.cinza);
    s.txt("Só leads de anúncio · Meta (Facebook/Instagram) e Google Ads", 64, 398, 13, C.cinza);
    s.txt("Preparado pela Tathy, gestora de tráfego do Kayser One", 64, H - 48, 12, C.ouro);
  }

  // 2. Resumo executivo
  {
    const s = nova();
    s.cabecalho("Resumo executivo", `Semana ${d.inicio}–${d.fim} e acumulado de ${d.mesNome}`, 2, TOTAL);
    const cpl = tot("leads") ? tot("gasto") / tot("leads") : null;
    const kpis: [string, string, string][] = [
      ["Investido na semana", brl(semTot("gasto")), `no mês: ${brl(tot("gasto"))}`],
      ["Leads na semana", String(semTot("leads")), `no mês: ${tot("leads")}`],
      ["Custo por lead (mês)", brl(cpl), "Meta + Google Ads"],
      ["Vendas no mês", String(tot("vendas")), tot("vgv") ? `VGV ${brl(tot("vgv"))}` : "sem VGV registrado"],
    ];
    kpis.forEach(([r, v, sub], i) => {
      const x = 48 + i * 222;
      s.ret(x, 120, 206, 118, C.painel, C.linha);
      s.txt(r, x + 16, 148, 12, C.cinza);
      s.txt(v, x + 16, 192, 30, C.ouroClaro, true);
      s.txt(sub, x + 16, 220, 11, C.cinza);
    });
    s.txt("O que a Tathy viu", 48, 284, 16, C.texto, true);
    let y = 312;
    for (const a of (P.alertas ?? []).slice(0, 5)) {
      const cor = a.nivel === "critico" ? C.vermelho : a.nivel === "atencao" ? C.ambar : C.google;
      s.ret(48, y - 11, 6, 14, cor);
      y = s.paragrafo(a.texto, 64, y, 820, 13, C.texto, 2) + 6;
    }
  }

  // 3. Meta x Google Ads
  {
    const s = nova();
    s.cabecalho("Meta x Google Ads", `Acumulado de ${d.mesNome} · leads reais que chegaram no K1`, 3, TOTAL);
    const linhas: [string, (c: string) => string][] = [
      ["Investimento", (c) => brl(P.canais[c].gasto)],
      ["Leads no K1", (c) => String(P.canais[c].leads)],
      ["Leads que a plataforma diz", (c) => (P.canais[c].leadsPlataforma ? String(Math.round(P.canais[c].leadsPlataforma)) : "—")],
      ["Custo por lead", (c) => brl(P.canais[c].cpl)],
      ["Vendas", (c) => String(P.canais[c].vendas)],
      ["Custo por venda", (c) => brl(P.canais[c].custoVenda)],
      ["Sem interesse no mês", (c) => String(P.canais[c].semInteresse)],
      ["Investido na semana", (c) => brl(d.semana[c]?.gasto ?? 0)],
      ["Leads na semana", (c) => String(d.semana[c]?.leads ?? 0)],
    ];
    s.ret(48, 118, 864, 36, C.painel);
    s.txt("Indicador", 64, 142, 13, C.cinza, true);
    s.txtDir("Meta", 640, 142, 14, C.meta, true);
    s.txtDir("Google Ads", 880, 142, 14, C.google, true);
    linhas.forEach(([r, fn], i) => {
      const y = 182 + i * 34;
      if (i % 2) s.ret(48, y - 22, 864, 34, C.painel);
      s.txt(r, 64, y, 14);
      s.txtDir(fn("meta"), 640, y, 15, C.texto, true);
      s.txtDir(fn("google"), 880, y, 15, C.texto, true);
    });
    s.txt("Guiar pelos leads do K1: a plataforma conta conversas e cliques que nem sempre viram lead real.", 48, 500, 11, C.cinza);
  }

  // 4. Funil e tempo parado
  {
    const s = nova();
    s.cabecalho("Funil dos leads de anúncio", "Todos os leads de anúncio por etapa: quantos, com quem estão e há quanto tempo parados", 4, TOTAL);
    const etapas: Record<string, any> = {};
    for (const f of P.funil ?? []) {
      const e = (etapas[f.titulo] ??= { titulo: f.titulo, pos: f.pos, total: 0, comCorretor: 0, comGestor: 0, soma: 0, max: 0 });
      e.total += f.total;
      e.comCorretor += f.comCorretor;
      e.comGestor += f.comGestor + f.semDono;
      e.soma += f.diasMedio * f.total;
      e.max = Math.max(e.max, f.diasMax);
    }
    const lista = Object.values(etapas).sort((a: any, z: any) => a.pos - z.pos).slice(0, 9) as any[];
    const maior = Math.max(1, ...lista.map((e) => e.total));
    s.txt("Etapa", 48, 128, 11, C.cinza, true);
    s.txtDir("Leads", 520, 128, 11, C.cinza, true);
    s.txtDir("Corretor", 620, 128, 11, C.cinza, true);
    s.txtDir("Gerente/sem dono", 760, 128, 11, C.cinza, true);
    s.txtDir("Parado (média)", 900, 128, 11, C.cinza, true);
    lista.forEach((e, i) => {
      const y = 160 + i * 38;
      const media = e.total ? e.soma / e.total : 0;
      s.txt(e.titulo, 48, y, 13);
      s.ret(230, y - 14, (230 * e.total) / maior, 16, C.ouro);
      s.txtDir(e.total, 520, y, 13, C.texto, true);
      s.txtDir(e.comCorretor, 620, y, 13);
      s.txtDir(e.comGestor, 760, y, 13, e.comGestor ? C.ambar : C.texto);
      s.txtDir(diasTxt(media), 900, y, 13, media > 7 ? C.vermelho : C.texto);
    });
  }

  // 5. Com quem estão os leads (REGRA: corretor x gerente)
  {
    const s = nova();
    s.cabecalho("Com quem estão os leads", "Leads de anúncio em aberto: corretores x gerentes, por pessoa e tempo parado", 5, TOTAL);
    const lista = (P.porResponsavel ?? []) as any[];
    const corretores = lista.filter((r) => r.cargo === "corretor");
    const gestores = lista.filter((r) => r.cargo !== "corretor");
    const soma = (l: any[]) => l.reduce((a, r) => a + r.leads, 0);
    const total = soma(lista) || 1;
    const tiles: [string, string, ReturnType<typeof rgb>][] = [
      ["Leads em aberto", String(soma(lista)), C.ouroClaro],
      ["Com corretor", `${soma(corretores)} (${Math.round((soma(corretores) / total) * 100)}%)`, C.google],
      ["Com gerente / Diretor / sem dono", `${soma(gestores)} (${Math.round((soma(gestores) / total) * 100)}%)`, C.ambar],
    ];
    tiles.forEach(([r, v, cor], i) => {
      const x = 48 + i * 292;
      s.ret(x, 110, 276, 70, C.painel, C.linha);
      s.txt(r, x + 14, 134, 11, C.cinza);
      s.txt(v, x + 14, 166, 22, cor, true);
    });
    const coluna = (titulo: string, itens: any[], x: number, cor: ReturnType<typeof rgb>) => {
      s.txt(titulo, x, 214, 14, cor, true);
      s.txtDir("Leads", x + 330, 214, 10, C.cinza, true);
      s.txtDir("Parado (média)", x + 420, 214, 10, C.cinza, true);
      itens.slice(0, 9).forEach((r, i) => {
        const y = 242 + i * 28;
        if (i % 2) s.ret(x - 6, y - 19, 432, 28, C.painel);
        s.txt(limpar(r.nome).slice(0, 34), x, y, 12);
        s.txtDir(r.leads, x + 330, y, 12, C.texto, true);
        s.txtDir(diasTxt(r.diasMedio || 0), x + 420, y, 12, (r.diasMedio || 0) > 7 ? C.vermelho : C.texto);
      });
      if (itens.length > 9) s.txt(`+ ${itens.length - 9} pessoa(s) com ${soma(itens.slice(9))} lead(s)`, x, 242 + 9 * 28, 11, C.cinza);
      if (!itens.length) s.txt("Ninguém.", x, 242, 12, C.cinza);
    };
    coluna("Corretores", corretores, 48, C.google);
    coluna("Gerentes / Diretor / sem dono", gestores, 498, C.ambar);
  }

  // 6. Pódio (troféu) — os 3 primeiros do ranking
  {
    const s = nova();
    s.cabecalho("Pódio da semana", `Os 3 melhores corretores com leads de anúncio em ${d.mesNome}`, 6, TOTAL);
    const top = (P.rankingCorretores ?? []).slice(0, 3) as any[];
    const PRATA = hex("#c9ced6");
    const BRONZE = hex("#cd7f32");
    const pct = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
    // ordem visual: 2º à esquerda, 1º no meio, 3º à direita
    const lugares: [number, number, number, ReturnType<typeof rgb>][] = [
      [1, 290, 150, PRATA],
      [0, 480, 210, C.ouro],
      [2, 670, 110, BRONZE],
    ];
    const base = 500;
    for (const [i, cx, alt, cor] of lugares) {
      const r = top[i];
      if (!r) continue;
      s.ret(cx - 70, base - alt, 140, alt, cor);
      s.ret(cx - 70, base - alt, 140, 6, C.texto);
      const lugar = `${i + 1}º`;
      s.txt(lugar, cx - s.largura(lugar, 40, true) / 2, base - alt + 56, 40, C.fundo, true);
      if (i === 0) s.trofeu(cx, base - alt - 150, 70);
      else s.medalha(cx, base - alt - 82, 16, cor, i + 1);
      const nome = limpar(r.nome).split(" ").slice(0, 2).join(" ");
      s.txt(nome, cx - s.largura(nome, 14, true) / 2, base - alt - 46, 14, C.texto, true);
      const l1 = `${r.vendas} venda(s) · ${r.visitas} visita(s)`;
      const l2 = `${r.recebidos} leads · ${pct(r.pctAgendamento)} agendaram`;
      s.txt(l1, cx - s.largura(l1, 10) / 2, base - alt - 28, 10, C.cinza);
      s.txt(l2, cx - s.largura(l2, 10) / 2, base - alt - 14, 10, C.cinza);
    }
    if (!top.length) s.txt("Ainda sem corretores com leads de anúncio no mês.", 48, 200, 14, C.cinza);
    s.txt("Critério: vendas, depois visitas, depois agendamentos, depois leads recebidos.", 48, 524, 10, C.cinza);
  }

  // 7. Ranking dos corretores (regra: com porcentagens e todos os números)
  {
    const s = nova();
    s.cabecalho("Ranking dos corretores", `Leads de anúncio recebidos em ${d.mesNome} e o que cada um fez — planilha completa no anexo`, 7, TOTAL);
    const pct = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
    const cols: [string, number][] = [["Recebidos", 440], ["Agend.", 530], ["Visitas", 625], ["Vendas", 715], ["Sem interesse", 830], ["Parado", 912]];
    s.txt("#", 48, 128, 11, C.cinza, true);
    s.txt("Corretor", 80, 128, 11, C.cinza, true);
    cols.forEach(([t, x]) => s.txtDir(t, x, 128, 11, C.cinza, true));
    const lista = (P.rankingCorretores ?? []).slice(0, 12);
    lista.forEach((r: any, i: number) => {
      const y = 156 + i * 29;
      if (i % 2) s.ret(40, y - 19, 880, 29, C.painel);
      if (i < 3) s.medalha(56, y - 5, 10, i === 0 ? C.ouro : i === 1 ? hex("#c9ced6") : hex("#cd7f32"), i + 1);
      else s.txt(String(r.posicao), 50, y, 13, C.cinza, true);
      s.txt(limpar(r.nome).slice(0, 34), 80, y, 12, C.texto, i < 3);
      s.txtDir(r.recebidos, 440, y, 12, C.texto, true);
      s.txtDir(`${r.agendamentos + r.visitas} · ${pct(r.pctAgendamento)}`, 530, y, 11);
      s.txtDir(`${r.visitas} · ${pct(r.pctVisita)}`, 625, y, 11);
      s.txtDir(`${r.vendas} · ${pct(r.pctVenda)}`, 715, y, 11, r.vendas ? C.google : C.texto, !!r.vendas);
      s.txtDir(`${r.semInteresse} · ${pct(r.pctSemInteresse)}`, 830, y, 11, r.pctSemInteresse > 30 ? C.vermelho : C.texto);
      s.txtDir(diasTxt(r.diasParado || 0), 912, y, 11, (r.diasParado || 0) > 7 ? C.vermelho : C.texto);
    });
    if (!lista.length) s.txt("Nenhum lead de anúncio com corretor neste mês.", 48, 160, 14, C.cinza);
    const resto = (P.rankingCorretores ?? []).length - lista.length;
    if (resto > 0) s.txt(`+ ${resto} corretor(es) na planilha anexa.`, 48, 512, 11, C.cinza);
  }

  // 8. Leads parados
  {
    const s = nova();
    s.cabecalho("Leads mais parados na esteira", "Abertos há mais tempo sem mudar de etapa — cobrar quem está com eles", 8, TOTAL);
    const cols: [string, number, boolean][] = [["Lead", 48, false], ["Canal", 300, false], ["Etapa", 400, false], ["Parado", 640, true], ["Com quem", 912, true]];
    cols.forEach(([t, x, dir]) => (dir ? s.txtDir(t, x, 128, 11, C.cinza, true) : s.txt(t, x, 128, 11, C.cinza, true)));
    (P.parados ?? []).slice(0, 10).forEach((p: any, i: number) => {
      const y = 158 + i * 34;
      if (i % 2) s.ret(40, y - 22, 880, 34, C.painel);
      s.txt(limpar(p.nome).slice(0, 30), 48, y, 13);
      s.txt(CANAL_NOME[p.canal] ?? p.canal, 300, y, 12, CANAL_COR[p.canal] ?? C.texto, true);
      s.txt(limpar(p.etapa).slice(0, 26), 400, y, 12, C.cinza);
      s.txtDir(diasTxt(p.dias), 640, y, 13, p.dias > 7 ? C.vermelho : C.ambar, true);
      s.txtDir(p.responsavel ? limpar(p.responsavel).slice(0, 30) : "sem dono", 912, y, 12);
    });
    if (!(P.parados ?? []).length) s.txt("Nenhum lead de anúncio aberto.", 48, 170, 14, C.cinza);
  }

  // 6. Anúncios
  {
    const s = nova();
    s.cabecalho("Anúncios: o que manter, trocar ou escalar", "Nota da Tathy contra a média do próprio canal (critério de gestor de tráfego)", 9, TOTAL);
    let y = 128;
    const lista = (P.anuncios ?? []).slice(0, 6);
    for (const a of lista) {
      const [nt, cor] = NOTA[a.nota] ?? NOTA.sem_veredito;
      s.ret(48, y - 6, 864, 58, C.painel, C.linha);
      s.ret(48, y - 6, 5, 58, cor);
      s.txt(nt, 64, y + 12, 10, cor, true);
      s.txt(CANAL_NOME[a.canal] ?? a.canal, 150, y + 12, 10, CANAL_COR[a.canal] ?? C.texto, true);
      s.txt(limpar(a.anuncio).slice(0, 60), 240, y + 12, 12, C.texto, true);
      s.txtDir(`${brl(a.gasto)} · ${Math.round(a.conversoes)} leads${a.cpl != null ? ` · ${brl(a.cpl)}/lead` : ""}`, 900, y + 12, 11, C.cinza);
      s.paragrafo(a.dica, 64, y + 34, 830, 11, C.ouroClaro, 1);
      y += 66;
    }
    if (!lista.length) s.txt("Ainda sem números por anúncio. Conectar o Google Ads (script) e puxar o Meta.", 48, 170, 14, C.cinza);
  }

  // 7. Sem interesse
  {
    const s = nova();
    s.cabecalho("Clientes sem interesse", `${d.mesNome}: motivo escrito pelo corretor e quem marcou`, 10, TOTAL);
    s.txt("Por corretor", 48, 128, 14, C.texto, true);
    let y = 158;
    const rk = (P.ranking ?? []).slice(0, 8);
    const maior = Math.max(1, ...rk.map((r: any) => r.total));
    for (const r of rk) {
      s.txt(limpar(r.nome).slice(0, 24), 48, y, 12);
      s.ret(230, y - 12, (120 * r.total) / maior, 14, C.vermelho);
      s.txt(String(r.total), 360, y, 12, C.texto, true);
      y += 30;
    }
    if (!rk.length) s.txt("Nenhum no período.", 48, 160, 13, C.cinza);
    s.txt("Últimos motivos", 420, 128, 14, C.texto, true);
    y = 158;
    for (const m of (P.semInteresse ?? []).slice(0, 7)) {
      s.txt(`${limpar(m.nome).slice(0, 26)} · ${limpar(m.corretor ?? "sem corretor").slice(0, 24)}`, 420, y, 11, C.cinza);
      y = s.paragrafo(`“${m.motivo ?? "sem justificativa (antes da regra)"}”`, 420, y + 16, 490, 12, m.motivo ? C.texto : C.ambar, 2) + 8;
    }
  }

  // 8. Plano da semana
  {
    const s = nova();
    s.cabecalho("Plano para esta semana", "Ações recomendadas pela Tathy, em ordem de impacto", 11, TOTAL);
    const acoes: string[] = [];
    const anuncios = P.anuncios ?? [];
    for (const a of anuncios.filter((x: any) => x.nota === "problema").slice(0, 2)) acoes.push(`Trocar ou pausar "${a.anuncio}" (${CANAL_NOME[a.canal]}): ${a.dica}`);
    for (const a of anuncios.filter((x: any) => x.nota === "bom").slice(0, 2)) acoes.push(`Escalar "${a.anuncio}" (${CANAL_NOME[a.canal]}): lead a ${brl(a.cpl)}, abaixo da média.`);
    if ((P.paraDistribuir ?? []).length) acoes.push(`Distribuir ${P.paraDistribuir.length} lead(s) de anúncio parado(s) com gerente/Diretor ou sem dono.`);
    const parado = (P.parados ?? []).filter((p: any) => p.dias > 7).length;
    if (parado) acoes.push(`Cobrar o andamento de ${parado} lead(s) parados há mais de 7 dias na mesma etapa.`);
    if (!P.canais.google.temDados) acoes.push("Conectar o script do Google Ads para a Tathy avaliar os anúncios do Google.");
    if (!acoes.length) acoes.push("Manter a operação: números dentro do esperado. Acompanhar o custo por lead diariamente.");
    let y = 134;
    acoes.slice(0, 6).forEach((t, i) => {
      s.ret(48, y - 18, 30, 30, C.ouro);
      s.txt(String(i + 1), 58, y + 2, 15, C.fundo, true);
      y = Math.max(s.paragrafo(t, 94, y, 800, 14, C.texto, 3), y + 30) + 24;
    });
  }

  return pdf.save();
}
