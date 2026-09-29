import { ehAvisoDaFila } from "./conversations.service";

describe("ehAvisoDaFila (cargos não veem por quais corretores o lead passou)", () => {
  it("reconhece o aviso de passagem da fila", () => {
    expect(ehAvisoDaFila("Olá! 👋 Você agora será atendido pelo nosso especialista *Marcone Xavier*, que já vai falar com você. 🏡")).toBe(true);
  });
  it("não esconde mensagem normal do Kayser/cliente", () => {
    expect(ehAvisoDaFila("Olá, Marlene! Eu sou o *Kayser*...")).toBe(false);
    expect(ehAvisoDaFila("📋 *Sua visita está marcada!*")).toBe(false);
    expect(ehAvisoDaFila(null)).toBe(false);
  });
});
