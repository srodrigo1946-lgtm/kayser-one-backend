import { comCodigoBrasil, variantesDoTelefone } from "./telefone";

describe("Telefone com o 55 do Brasil", () => {
  it("DDD + número ganha o 55 (era o motivo de 'número não tem WhatsApp')", () => {
    expect(comCodigoBrasil("21 99999-8888")).toBe("5521999998888");
    expect(comCodigoBrasil("(21) 3333-4444")).toBe("552133334444");
  });
  it("quem já tem o 55, internacional ou grupo não muda", () => {
    expect(comCodigoBrasil("5521999998888")).toBe("5521999998888");
    expect(comCodigoBrasil("552133334444")).toBe("552133334444");
    expect(comCodigoBrasil("120363025246125888")).toBe("120363025246125888");
    expect(comCodigoBrasil("")).toBe("");
  });
  it("acha a conversa com ou sem o 55", () => {
    expect(variantesDoTelefone("21999998888")).toEqual(["5521999998888", "21999998888"]);
    expect(variantesDoTelefone("5521999998888")).toEqual(["5521999998888", "21999998888"]);
    expect(variantesDoTelefone("120363025246125888")).toEqual(["120363025246125888"]);
  });
});
