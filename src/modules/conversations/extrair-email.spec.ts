import { extrairEmail } from "./conversations.service";

describe("extrairEmail", () => {
  it("pega o e-mail do meio da frase", () => {
    expect(extrairEmail("meu email é Rodrigo.Silva@Gmail.com, obrigado")).toBe("rodrigo.silva@gmail.com");
    expect(extrairEmail("🎤 Áudio: \"pode mandar pra ana_22@hotmail.com.br.\"")).toBe("ana_22@hotmail.com.br");
  });
  it("sem e-mail devolve null", () => {
    expect(extrairEmail("quero saber do ilha stay")).toBeNull();
    expect(extrairEmail("")).toBeNull();
  });
});

describe("extrairEmail — e-mail falado no áudio", () => {
  it("entende 'arroba' e 'ponto'", () => {
    expect(extrairEmail('🎤 Áudio: "meu email é rodrigo arroba gmail ponto com"')).toBe("rodrigo@gmail.com");
    expect(extrairEmail("é ana ponto souza arroba hotmail ponto com ponto br")).toBe("ana.souza@hotmail.com.br");
    expect(extrairEmail("joao underline 22 arroba yahoo ponto com")).toBe("joao_22@yahoo.com");
  });
  it("frase sem arroba não inventa e-mail", () => {
    expect(extrairEmail("quero visitar no sábado ponto final")).toBeNull();
  });
});
