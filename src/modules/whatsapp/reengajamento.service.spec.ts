import { classificarResposta, mensagemReengajar } from "./reengajamento.service";

describe("Reengajamento dos clientes 'sem interesse'", () => {
  it("entende NÃO (sai do Kayser)", () => {
    for (const t of ["Não", "nao obrigado", "Não tenho interesse", "já comprei", "pare", "não quero mais receber mensagem"]) {
      expect(classificarResposta(t)).toBe("nao");
    }
  });
  it("entende SIM (vai pra fila)", () => {
    for (const t of ["Sim", "tenho interesse", "quero saber", "pode mandar", "me conta", "Opa, quais as condições?", "manda mais informações", "Gostei, quero saber mais", "qual o valor?", "estou interessada", "dá pra agendar uma visita?"]) {
      expect(classificarResposta(t)).toBe("sim");
    }
  });
  it("o resto segue a conversa normal", () => {
    expect(classificarResposta("quem é?")).toBe("outro");
    expect(classificarResposta("")).toBe("outro");
  });
  it("mensagens variam, usam o primeiro nome e oferecem sair", () => {
    const a = mensagemReengajar("maria silva", "Ilhamar", 0);
    const b = mensagemReengajar("maria silva", "Ilhamar", 1);
    expect(a).not.toBe(b);
    expect(a).toContain("Maria");
    expect(a).toContain("Ilhamar");
    expect(a).toContain("responder NÃO");
  });
});

describe("Reengajamento — só cita empreendimento cadastrado", () => {
  const { acharPorNome } = require("./ia-one.util");
  const imoveis = ["Ilha stay home Resort", "Villa Santé", "Sky Mário Guimarães"];
  it("resposta de formulário não vira nome de empreendimento", () => {
    expect(acharPorNome(imoveis, "Agende sua visita!", (x: string) => x)).toBeUndefined();
    expect(acharPorNome(imoveis, "Ilha Stay", (x: string) => x)).toBe("Ilha stay home Resort");
  });
});

describe("Reengajamento — marca própria", () => {
  const { mensagemReengajar: msg } = require("./reengajamento.service");
  it("usa o nome da imobiliária no lugar de Kayser", () => {
    const textos = [0, 2, 5].map((i) => msg("ana", null, i, "Imob Vista"));
    for (const t of textos) expect(t).not.toMatch(/Kayser/);
    expect(textos.join(" ")).toMatch(/Aqui é da Imob Vista/);
    expect(msg("ana", null, 0)).toMatch(/Aqui é da Kayser/); // padrão continua
  });
});
