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

  it("sem pergunta personalizada = vazio", () => {
    expect(respostasFormulario([{ name: "full_name", values: ["Ana"] }])).toEqual([]);
  });
});
