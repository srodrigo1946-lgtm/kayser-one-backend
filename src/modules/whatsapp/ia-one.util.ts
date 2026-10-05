// IA One: leitura das planilhas (Google Sheets/CSV) e simulação de pagamento.
// Funções puras — testadas em ia-one.util.spec.ts.

/** CSV simples com aspas (campos com vírgula/quebra de linha entre aspas). */
export function lerCsv(texto: string): string[][] {
  const linhas: string[][] = [];
  let campo = "";
  let linha: string[] = [];
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ",") {
      linha.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = "";
    } else campo += c;
  }
  if (campo || linha.length) {
    linha.push(campo);
    linhas.push(linha);
  }
  return linhas;
}

/** "458.500" / "R$ 1.067,40" / "33,32" → número (pt-BR). */
export function numBR(v: string | undefined): number {
  if (!v) return 0;
  const s = String(v).replace(/[R$\s%]/g, "");
  if (!s) return 0;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/\./g, ""));
  return isFinite(n) ? n : 0;
}

/** Link do Google Sheets (/edit…) → link de exportação CSV (mantém a aba gid). */
export function linkCsv(url: string): string {
  const m = url.match(/docs\.google\.com\/spreadsheets\/d\/([\w-]+)/);
  if (!m) return url;
  const gid = url.match(/[#&?]gid=(\d+)/)?.[1];
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${gid ? `&gid=${gid}` : ""}`;
}

const semAcento = (t: string) => (t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export type Empreendimento = {
  nome: string;
  modulo: string;
  mesesEntrega: number;
  valorVenda: number;
  estoque: number;
  avaliacao: number;
};

/** Planilha "Simulador Pro Soluto": tabela "Nome do Empreendimento | Módulo | Meses para Entrega | …". */
export function lerSimulador(linhas: string[][]): { campanha: string; empreendimentos: Empreendimento[] } {
  const topo = (linhas[0] || []).filter(Boolean).join(" · ");
  const i = linhas.findIndex((l) => semAcento(l[0] || "") === "nome do empreendimento");
  const empreendimentos: Empreendimento[] = [];
  if (i >= 0) {
    for (const l of linhas.slice(i + 1)) {
      const nome = (l[0] || "").trim();
      if (!nome) break;
      const valorVenda = numBR(l[4]);
      if (!valorVenda) continue;
      empreendimentos.push({
        nome,
        modulo: (l[1] || "").trim(),
        mesesEntrega: numBR(l[2]),
        valorVenda,
        estoque: numBR(l[5]),
        avaliacao: numBR(l[6]),
      });
    }
  }
  return { campanha: topo, empreendimentos };
}

export type Unidade = {
  produto: string;
  bloco: string;
  unidade: string;
  status: string;
  entrega: string;
  vaga: string;
  tipo: string;
  area: number;
  preco: number;
  avaliacao: number;
};

/**
 * Tabela de unidades (export CSV do Data Studio "Disponibilidade e Tabelas"):
 * acha o cabeçalho pelos nomes (PRODUTO, UNIDADE, PREÇO…), em qualquer ordem.
 */
export function lerUnidades(linhas: string[][]): Unidade[] {
  const idx = linhas.findIndex((l) => {
    const h = l.map(semAcento);
    return h.includes("produto") && h.includes("unidade") && h.some((x) => x.startsWith("preco"));
  });
  if (idx < 0) return [];
  const h = linhas[idx].map(semAcento);
  const col = (...nomes: string[]) => h.findIndex((x) => nomes.some((n) => x === n || x.startsWith(n)));
  const c = {
    produto: col("produto"),
    bloco: col("bloco"),
    unidade: col("unidade"),
    status: col("status"),
    entrega: col("data de entrega", "entrega"),
    vaga: col("vaga"),
    tipo: col("tipo", "tipologia"),
    area: col("area"),
    preco: col("preco"),
    avaliacao: col("avaliacao"),
  };
  const v = (l: string[], i: number) => (i >= 0 ? (l[i] || "").trim() : "");
  return linhas
    .slice(idx + 1)
    .filter((l) => v(l, c.produto) && v(l, c.unidade))
    .map((l) => ({
      produto: v(l, c.produto),
      bloco: v(l, c.bloco),
      unidade: v(l, c.unidade),
      status: v(l, c.status),
      entrega: v(l, c.entrega),
      vaga: v(l, c.vaga),
      tipo: v(l, c.tipo),
      area: numBR(v(l, c.area)),
      preco: numBR(v(l, c.preco)),
      avaliacao: numBR(v(l, c.avaliacao)),
    }));
}

/** Acha pelo nome, tolerante (sem acento, parte do nome). */
export function acharPorNome<T>(lista: T[], nome: string, campo: (x: T) => string): T | undefined {
  const alvo = semAcento(nome);
  if (!alvo) return undefined;
  return (
    lista.find((x) => semAcento(campo(x)) === alvo) ||
    lista.find((x) => semAcento(campo(x)).includes(alvo)) ||
    lista.find((x) => alvo.includes(semAcento(campo(x)).split(" ")[0]))
  );
}

/** Meses até a entrega a partir de "02/2027" (mês/ano). 0 se já entregue/inválido. */
export function mesesAte(entrega: string, hoje = new Date()): number {
  const m = (entrega || "").match(/(\d{1,2})\/(\d{4})/);
  if (!m) return 0;
  const meses = (Number(m[2]) - hoje.getFullYear()) * 12 + (Number(m[1]) - (hoje.getMonth() + 1));
  return Math.max(0, meses);
}

export type Tabela = "padrao" | "investidor" | "caixa";

export type Simulacao = {
  tabela: Tabela;
  preco: number;
  mesesObra: number;
  linhas: { item: string; parcelas: number; valorParcela: number; total: number }[];
  observacao: string;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Fluxos do Rodrigo (04/10/2026):
 * - padrão: 10% ato · 20% durante a obra (mensal até a entrega) · 70% pós-obra em 120x
 * - investidor: 10% ato · 90% durante a obra (mensal até a entrega)
 * - caixa: financiamento Caixa + FGTS/subsídio; a diferença (entrada) = 10% ato
 *   (ou o que faltar) + o resto mensal durante a obra.
 * Valores SEM correção (INCC/IPCA) — a IA sempre avisa.
 */
export function simularPagamento(p: {
  preco: number;
  tabela: Tabela;
  mesesObra: number;
  financiamento?: number;
  fgtsSubsidio?: number;
}): Simulacao {
  const preco = Math.max(0, p.preco || 0);
  const meses = Math.max(1, Math.round(p.mesesObra || 0)); // pronto: 1 parcela na entrega
  const linhas: Simulacao["linhas"] = [];
  const add = (item: string, total: number, parcelas: number) => {
    if (total <= 0) return;
    linhas.push({ item, parcelas, valorParcela: r2(total / parcelas), total: r2(total) });
  };
  let observacao = "Valores sem correção (INCC/IPCA), sujeitos à aprovação e à política vigente.";
  if (p.tabela === "padrao") {
    add("Ato (10%)", preco * 0.1, 1);
    add("Durante a obra (20%)", preco * 0.2, meses);
    add("Pós-obra (70%)", preco * 0.7, 120);
  } else if (p.tabela === "investidor") {
    add("Ato (10%)", preco * 0.1, 1);
    add("Durante a obra até a entrega (90%)", preco * 0.9, meses);
  } else {
    const fin = Math.max(0, p.financiamento || 0);
    const fgts = Math.max(0, p.fgtsSubsidio || 0);
    const entrada = Math.max(0, preco - fin - fgts);
    const ato = Math.min(entrada, preco * 0.1);
    add("Financiamento Caixa (na assinatura)", fin, 1);
    add("FGTS + subsídio", fgts, 1);
    add("Ato", ato, 1);
    add("Entrada restante durante a obra", entrada - ato, meses);
    observacao = `Financiamento e subsídio sujeitos à aprovação da Caixa. ${observacao}`;
  }
  return { tabela: p.tabela, preco: r2(preco), mesesObra: meses, linhas, observacao };
}

/** Texto curto da simulação pro WhatsApp. */
export function textoSimulacao(s: Simulacao, rotulo: string): string {
  const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const nomes: Record<Tabela, string> = { padrao: "Tabela padrão", investidor: "Tabela investidor", caixa: "Financiamento Caixa" };
  const corpo = s.linhas
    .map((l) => (l.parcelas > 1 ? `• ${l.item}: ${l.parcelas}x de ${brl(l.valorParcela)} (total ${brl(l.total)})` : `• ${l.item}: ${brl(l.total)}`))
    .join("\n");
  return `*${nomes[s.tabela]} — ${rotulo}*\nValor: ${brl(s.preco)} · obra: ${s.mesesObra} ${s.mesesObra === 1 ? "mês" : "meses"}\n${corpo}\n_${s.observacao}_`;
}

/**
 * Unidades da aba do simulador ("STATUS DA UNIDADE | IDENTIFICADOR | VALOR DE VENDA |
 * AVALIAÇÃO | MÓDULO | ENTREGA PJ | ENTREGA OBRA"): só do empreendimento SELECIONADO
 * no simulador (bloco "DADOS DA UNIDADE"). Entrega em meses → "MM/AAAA".
 */
export function lerUnidadesSimulador(linhas: string[][], hoje = new Date()): Unidade[] {
  const iDados = linhas.findIndex((l) => semAcento(l[0] || "") === "dados da unidade");
  let produto = "";
  if (iDados >= 0) {
    const l = linhas.slice(iDados, iDados + 6).find((x) => (x[0] || "").trim() && semAcento(x[1] || "").startsWith("meses para entrega"));
    produto = (l?.[0] || "").trim();
  }
  const iCab = linhas.findIndex((l) => semAcento(l[0] || "") === "status da unidade" && semAcento(l[1] || "") === "identificador");
  if (iCab < 0 || !produto) return [];
  const mesAno = (meses: number) => {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() + meses, 1);
    return `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  };
  return linhas
    .slice(iCab + 1)
    .filter((l) => (l[0] || "").trim() && (l[1] || "").trim())
    .map((l) => ({
      produto,
      bloco: (l[1].match(/BL(\d+)/i)?.[1] || "").replace(/^0+/, ""),
      unidade: l[1].trim(),
      status: l[0].trim(),
      entrega: mesAno(numBR(l[6])),
      vaga: "",
      tipo: "",
      area: 0,
      preco: numBR(l[2]),
      avaliacao: numBR(l[3]),
    }));
}

/** Aba "UNIDADES PROMOCIONAIS": linhas da tabela da esquerda, em texto curto pro prompt. */
export function lerPromocoes(linhas: string[][]): string[] {
  const i = linhas.findIndex((l) => semAcento(l[0] || "") === "nome do empreendimento" && semAcento(l[1] || "").startsWith("valor minimo"));
  if (i < 0) return [];
  return linhas
    .slice(i + 1)
    .filter((l) => (l[0] || "").trim() && (l[5] || "").trim())
    .map((l) => `${l[0].trim()} ${l[5].trim()} (${(l[6] || "").trim()}): mínimo ${l[1]} · bruto ${l[4]} · desconto ato em triplo ${l[2]} · volta ao caixa ${l[3]}`);
}

/** Abas de uma planilha pública (nome → gid), lidas do htmlview. */
export function abasDoHtmlview(html: string): { nome: string; gid: string }[] {
  return [...html.matchAll(/name: "([^"]+)", pageUrl: "[^"]*?gid=(\d+)/g)].map((m) => ({ nome: m[1], gid: m[2] }));
}
