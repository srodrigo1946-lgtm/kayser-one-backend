import { respostasFormulario } from "./meta-forms.service";

describe("respostasFormulario (formulário SWAT)", () => {
  it("pega renda e morar/investir e ignora nome/telefone/e-mail", () => {
    const r = respostasFormulario([
      { name: "full_name", values: ["Maria"] },
      { name: "phone_number", values: ["+5527999999999"] },
      { name: "email", values: ["m@x.com"] },
      { name: "renda_bruta", values: ["a_cima_r$10.000"] },
      { name: "para_mora_ou_investir?", values: ["investimento"] },
    ]);
    expect(r).toEqual(["Renda bruta: a cima r$10.000", "Para mora ou investir: investimento"]);
  });

  it("entrada direta (vitrine) repassa formulário e respostas", async () => {
    const { MetaFormsService } = await import("./meta-forms.service");
    const s: any = new MetaFormsService({} as any, {} as any, {} as any, { get: () => "" } as any, { get: async () => ({ metaVerifyToken: "tk" }) } as any, {} as any);
    let dados: any;
    s.criarLead = async (d: any) => (dados = d);
    const r = await s.recebeDireto("tk", { nome: "Ana", telefone: "21 99999-0000", formulario: "Vitrine SWAT - Villa Santé", respostas: ["Renda bruta: Acima de R$ 10 mil", "Objetivo: Morar"] });
    expect(r.ok).toBe(true);
    expect(dados.formulario).toBe("Vitrine SWAT - Villa Santé");
    expect(dados.respostas).toEqual(["Renda bruta: Acima de R$ 10 mil", "Objetivo: Morar"]);
    expect(await s.recebeDireto("errado", { telefone: "21999990000" })).toEqual({ ok: false });
  });

  it("vitrine: SWAT por padrão, geral se pedir, ignora robô e telefone ruim", async () => {
    const { MetaFormsService } = await import("./meta-forms.service");
    const s: any = new MetaFormsService({} as any, {} as any, {} as any, { get: () => "" } as any, {} as any, {} as any);
    const criados: any[] = [];
    s.criarLead = async (d: any) => criados.push(d);
    await s.recebeVitrine({ nome: "Ana Lima", telefone: "21999990000", renda: "R$ 10 mil a R$ 30 mil", objetivo: "Morar", imovel: "Stillo Barra" });
    expect(criados[0].formulario).toBe("Vitrine SWAT - Stillo Barra");
    expect(criados[0].respostas).toContain("Objetivo: Morar");
    await s.recebeVitrine({ nome: "Ana Lima", telefone: "21999990000", fila: "geral" });
    expect(criados[1].formulario).toBe("Vitrine - Geral");
    expect(await s.recebeVitrine({ nome: "Robo", telefone: "21999990000", site: "x" })).toEqual({ ok: true });
    expect((await s.recebeVitrine({ nome: "Ana", telefone: "123" })).ok).toBe(false);
    expect(criados).toHaveLength(2);
  });

  it("sem pergunta personalizada = vazio", () => {
    expect(respostasFormulario([{ name: "full_name", values: ["Ana"] }])).toEqual([]);
  });
});
