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
