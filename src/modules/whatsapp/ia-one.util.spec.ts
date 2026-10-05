import { lerCsv, numBR, linkCsv, lerSimulador, lerUnidades, mesesAte, simularPagamento, acharPorNome } from "./ia-one.util";

describe("IA One — planilhas e simulação", () => {
  it("lê CSV com aspas e números pt-BR", () => {
    expect(lerCsv('a,"b,c",d\n1,"x\ny",3')).toEqual([["a", "b,c", "d"], ["1", "x\ny", "3"]]);
    expect(numBR("458.500")).toBe(458500);
    expect(numBR("R$ 1.067,40")).toBe(1067.4);
    expect(numBR("33,32")).toBe(33.32);
  });

  it("transforma link do Google Sheets em CSV", () => {
    expect(linkCsv("https://docs.google.com/spreadsheets/d/ABC123/edit?usp=sharing")).toBe(
      "https://docs.google.com/spreadsheets/d/ABC123/export?format=csv"
    );
    expect(linkCsv("https://docs.google.com/spreadsheets/d/ABC/edit#gid=42")).toContain("&gid=42");
  });

  it("lê a tabela de empreendimentos do Simulador Pro Soluto", () => {
    const csv = [
      "DIRECIONAL RIO DE JANEIRO,SIMULADOR PRO SOLUTO,CAMPANHA G - 05/2026",
      "Nome do Empreendimento,Módulo,Meses para Entrega,Entrega PJ,Valor de Venda,Estoque,Avaliação",
      "Ilhamar Beach & Home,1,33,33,475.548,279,514.000",
      "Vibe Sunset,1,0,0,508.300,7,504.100",
      ",,,,,,",
    ].join("\n");
    const r = lerSimulador(lerCsv(csv));
    expect(r.campanha).toContain("CAMPANHA G");
    expect(r.empreendimentos).toHaveLength(2);
    expect(r.empreendimentos[0]).toEqual(expect.objectContaining({ nome: "Ilhamar Beach & Home", mesesEntrega: 33, valorVenda: 475548 }));
  });

  it("lê a tabela de unidades (export do Data Studio) pelo cabeçalho", () => {
    const csv = [
      "PRODUTO,BLOCO,UNIDADE,STATUS,DATA DE ENTREGA,VAGA,TIPO,ÁREA,PREÇO,AVALIAÇÃO",
      "BeON Porto Residencial,2,BL02-1112,Disponível,02/2027,0,Tipo 1Q,\"33,32\",303.125,327.000",
    ].join("\n");
    const u = lerUnidades(lerCsv(csv));
    expect(u).toEqual([expect.objectContaining({ produto: "BeON Porto Residencial", unidade: "BL02-1112", preco: 303125, area: 33.32, entrega: "02/2027" })]);
  });

  it("acha empreendimento pelo nome solto", () => {
    const l = [{ n: "Villa Santé Residence" }, { n: "Vibe Sunset" }];
    expect(acharPorNome(l, "villa sante", (x) => x.n)?.n).toBe("Villa Santé Residence");
  });

  it("meses até a entrega", () => {
    expect(mesesAte("02/2027", new Date(2026, 9, 4))).toBe(4); // out/2026 → fev/2027
    expect(mesesAte("01/2020", new Date(2026, 9, 4))).toBe(0);
  });

  it("tabela padrão: 10% ato, 20% obra, 70% em 120x", () => {
    const s = simularPagamento({ preco: 500000, tabela: "padrao", mesesObra: 10 });
    expect(s.linhas).toEqual([
      { item: "Ato (10%)", parcelas: 1, valorParcela: 50000, total: 50000 },
      { item: "Durante a obra (20%)", parcelas: 10, valorParcela: 10000, total: 100000 },
      { item: "Pós-obra (70%)", parcelas: 120, valorParcela: 2916.67, total: 350000 },
    ]);
  });

  it("tabela investidor: 10% ato e 90% até a entrega", () => {
    const s = simularPagamento({ preco: 300000, tabela: "investidor", mesesObra: 30 });
    expect(s.linhas[1]).toEqual({ item: "Durante a obra até a entrega (90%)", parcelas: 30, valorParcela: 9000, total: 270000 });
  });

  it("Caixa: entrada = preço − financiamento − FGTS; pronto = 1 parcela", () => {
    const s = simularPagamento({ preco: 400000, tabela: "caixa", mesesObra: 0, financiamento: 320000, fgtsSubsidio: 20000 });
    const total = s.linhas.reduce((a, l) => a + l.total, 0);
    expect(total).toBe(400000);
    expect(s.linhas.find((l) => l.item === "Ato")?.total).toBe(40000);
    expect(s.linhas.find((l) => l.item.startsWith("Entrada restante"))).toEqual(expect.objectContaining({ parcelas: 1, total: 20000 }));
  });
});

describe("IA One — abas extras da planilha", () => {
  const { lerUnidadesSimulador, lerPromocoes, abasDoHtmlview } = require("./ia-one.util");

  it("unidades do empreendimento selecionado no simulador", () => {
    const csv = [
      "DADOS DA UNIDADE,,,",
      ",Modulo,1",
      "Marine Barra Residence,Meses para entrega,8,Qtde disponíveis,55",
      "STATUS DA UNIDADE,IDENTIFICADOR,VALOR DE VENDA,AVALIAÇÃO,MÓDULO,ENTREGA PJ,ENTREGA OBRA",
      "Disponível,BL01-0306,487.800,544.600,1,12,8",
    ].join("\n");
    const u = lerUnidadesSimulador(lerCsv(csv), new Date(2026, 9, 4));
    expect(u).toEqual([expect.objectContaining({ produto: "Marine Barra Residence", unidade: "BL01-0306", preco: 487800, entrega: "06/2027", bloco: "1" })]);
  });

  it("unidades promocionais e abas da planilha", () => {
    const p = lerPromocoes(lerCsv("UNIDADES PROMOCIONAIS\nNome do Empreendimento,Valor Mínimo,Desconto Ato em Triplo,Volta ao Caixa,Valor de Venda Bruto,Identificador,Status da Unidade\nInn Barra Olímpica,R$ 247.940,R$ 5.060,R$ 0,R$ 253.000,BL02-0404,Disponível"));
    expect(p[0]).toContain("Inn Barra Olímpica BL02-0404 (Disponível)");
    expect(abasDoHtmlview('items.push({name: "UNIDADES PROMOCIONAIS", pageUrl: "https:\/\/x\/sheet?headers\x3dtrue&gid=91735735", gid:')).toEqual([{ nome: "UNIDADES PROMOCIONAIS", gid: "91735735" }]);
  });
});
