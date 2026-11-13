import { avaliarAnuncio, alertasTathy, leadsDasAcoes } from "./tathy.service";
import { exigirMotivoPerda } from "../leads/followup-regras";

const base = { canal: "meta", anuncio: "A", gasto: 300, cliques: 100, impressoes: 5000, conversoes: 10, dias: 10, diasSemResultado: 0 };

describe("Tathy — nota dos anúncios (critérios de gestor de tráfego)", () => {
  it("pouco volume = sem veredito", () => {
    expect(avaliarAnuncio({ ...base, dias: 3 }, 30).nota).toBe("sem_veredito");
    expect(avaliarAnuncio({ ...base, impressoes: 500 }, 30).nota).toBe("sem_veredito");
  });
  it("14 dias gastando sem lead = problema, mesmo com pouco volume", () => {
    expect(avaliarAnuncio({ ...base, conversoes: 0, dias: 14, diasSemResultado: 14, impressoes: 300 }, 30).nota).toBe("problema");
  });
  it("CPL >40% acima da média = problema; 15–40% = atenção; na média = bom", () => {
    expect(avaliarAnuncio({ ...base, gasto: 450 }, 30).nota).toBe("problema"); // 45 vs 30
    expect(avaliarAnuncio({ ...base, gasto: 360 }, 30).nota).toBe("atencao"); // 36 vs 30
    expect(avaliarAnuncio({ ...base, gasto: 300 }, 30).nota).toBe("bom");
  });
  it("muito clique e zero lead = problema na página, não no anúncio", () => {
    const r = avaliarAnuncio({ ...base, conversoes: 0, cliques: 150 }, 30);
    expect(r.nota).toBe("atencao");
    expect(r.dica).toMatch(/página|oferta/);
  });
  it("lê os leads das ações do Meta", () => {
    expect(leadsDasAcoes([{ action_type: "lead", value: "4" }, { action_type: "link_click", value: "90" }])).toBe(4);
    expect(leadsDasAcoes(undefined)).toBe(0);
  });
});

describe("Tathy — alertas em tempo real", () => {
  const c = { gasto: 1000, leads: 20, gastoHoje: 0, leadsHoje: 0, semInteresse: 0, temDados: true };
  it("tudo certo = ok", () => {
    expect(alertasTathy({ canais: { meta: c, google: c }, novoParado24h: 0, comGestor: 0, anunciosRuins: 0 })[0].nivel).toBe("ok");
  });
  it("gastou hoje sem lead, lead parado, google sem script, plataforma x K1", () => {
    const a = alertasTathy({
      canais: { meta: { ...c, gastoHoje: 80, leadsPlataforma: 40 }, google: { ...c, temDados: false } },
      novoParado24h: 3,
      comGestor: 2,
      anunciosRuins: 1,
    }).map((x) => x.texto).join(" | ");
    expect(a).toMatch(/hoje já gastou/);
    expect(a).toMatch(/Novo Lead/);
    expect(a).toMatch(/script/);
    expect(a).toMatch(/diz 40 leads/);
  });
});

describe("Sem interesse — motivo obrigatório", () => {
  it("pessoa sem motivo = erro; sistema passa; outras etapas não pedem", () => {
    expect(() => exigirMotivoPerda("novo_lead", "venda_perdida", "", { id: "u" })).toThrow(/motivo/);
    expect(exigirMotivoPerda("novo_lead", "venda_perdida", "  Já comprou com outra construtora ", { id: "u" })).toBe("Já comprou com outra construtora");
    expect(exigirMotivoPerda("novo_lead", "venda_perdida", undefined, null)).toBeNull();
    expect(exigirMotivoPerda("novo_lead", "em_atendimento", undefined, { id: "u" })).toBeNull();
  });
});
