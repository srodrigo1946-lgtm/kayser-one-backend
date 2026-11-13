import * as XLSX from "xlsx";
import { limpar, montarApresentacao, montarPlanilha } from "./tathy-relatorio";

const painel = {
  canais: {
    meta: { gasto: 2213.5, leads: 113, leadsPlataforma: 134, cpl: 19.6, vendas: 1, vgv: 350000, custoVenda: 2213, semInteresse: 3, temDados: true },
    google: { gasto: 0, leads: 1, leadsPlataforma: 0, cpl: null, vendas: 0, vgv: 0, custoVenda: null, semInteresse: 0, temDados: false },
  },
  alertas: [{ nivel: "critico", texto: "Meta: hoje já gastou R$ 80 e não veio lead → confira 🔥" }],
  funil: [{ canal: "meta", etapa: "em_atendimento", titulo: "Em Atendimento", pos: 2, total: 513, comCorretor: 512, comGestor: 1, semDono: 0, diasMedio: 24.3, diasMax: 69 }],
  porResponsavel: [
    { nome: "Claudia Marcello", cargo: "corretor", leads: 30, meta: 30, google: 0, diasMedio: 12 },
    { nome: "Isaac Mesquita", cargo: "gerente", leads: 2, meta: 2, google: 0, diasMedio: 40 },
  ],
  rankingCorretores: [
    { posicao: 1, nome: "Claudia Marcello", recebidos: 9, meta: 9, google: 0, abertos: 7, agendamentos: 2, visitas: 1, vendas: 1, semInteresse: 1, diasParado: 5, pctAgendamento: 33.3, pctVisita: 11.1, pctVenda: 11.1, pctSemInteresse: 11.1 },
  ],
  parados: [{ id: "1", nome: "Bia Lopes", canal: "meta", etapa: "Em Atendimento", dias: 113.9, responsavel: "Isaac", cargo: "gerente" }],
  paraDistribuir: [{ id: "1" }],
  anuncios: [{ canal: "meta", anuncio: "ILHA STAY HOME 03", nota: "bom", gasto: 551, impressoes: 9590, cliques: 734, conversoes: 53, cpl: 10.4, ctr: 0.077, dica: "Lead a R$ 10 (média R$ 17). Está funcionando." }],
  semInteresse: [{ id: "x", nome: "João", canal: "meta", motivo: "Comprou com outra construtora", em: new Date().toISOString(), corretor: "Claudia", marcadoPor: "Claudia" }],
  ranking: [{ nome: "Claudia", total: 1, semMotivo: 0 }],
};
const dados = { inicio: "06/11", fim: "12/11", mesNome: "Novembro", semana: { meta: { gasto: 500, leads: 40, semInteresse: 1 }, google: { gasto: 0, leads: 1, semInteresse: 0 } }, painel };

describe("Relatório da Tathy", () => {
  it("tira emoji/seta que a fonte do PDF não imprime", () => {
    expect(limpar("ok → 🔥 ação")).toBe("ok -> ação");
  });
  it("gera a apresentação (10 slides) sem quebrar com acento/emoji", async () => {
    const pdf = await montarApresentacao(dados);
    expect(Buffer.from(pdf).slice(0, 4).toString()).toBe("%PDF");
    const { PDFDocument } = await import("pdf-lib");
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(10);
  });
  it("gera a planilha com o ranking e as porcentagens", () => {
    const wb = XLSX.read(montarPlanilha(dados), { type: "buffer" });
    expect(wb.SheetNames).toEqual(["Ranking corretores", "Meta x Google", "Com quem estão", "Leads parados", "Anúncios", "Sem interesse"]);
    const rk: any[] = XLSX.utils.sheet_to_json(wb.Sheets["Ranking corretores"]);
    expect(rk[0].Corretor).toBe("Claudia Marcello");
    expect(rk[0]["% conversão em venda"]).toBe(11.1);
  });
});
