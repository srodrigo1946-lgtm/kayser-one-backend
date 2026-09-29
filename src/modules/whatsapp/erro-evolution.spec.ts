import { erroEvolution } from "./whatsapp.service";

const ax = (status: number | null, data?: any) => (status ? { response: { status, data }, message: "x" } : { message: "ECONNREFUSED" });

describe("erroEvolution (motivo real do erro do WhatsApp)", () => {
  it("Evolution sem resposta = fora do ar", () => {
    expect(erroEvolution(ax(null), "user_1").message).toContain("indisponível");
  });
  it("número sem WhatsApp", () => {
    const e = erroEvolution(ax(400, { response: { message: [{ exists: false, number: "5521900000000" }] } }), "user_1");
    expect(e.message).toContain("não tem WhatsApp");
  });
  it("instância não existe / desconectada", () => {
    expect(erroEvolution(ax(404, { response: { message: ["The \"user_1\" instance does not exist"] } }), "user_1").message).toContain("não está conectado");
    expect(erroEvolution(ax(500, { response: { message: ["Connection Closed"] } }), "user_1").message).toContain("desconectou");
  });
  it("outro erro mostra a mensagem da Evolution", () => {
    expect(erroEvolution(ax(500, { message: "rate limit" }), "user_1").message).toContain("rate limit");
  });
});
