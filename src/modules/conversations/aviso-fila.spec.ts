import { ehAvisoDaFila } from "./conversations.service";

describe("ehAvisoDaFila (cargos não veem por quais corretores o lead passou)", () => {
  it("reconhece o aviso de passagem da fila", () => {
    expect(ehAvisoDaFila("Olá! 👋 Você agora será atendido pelo nosso especialista *Marcone Xavier*, que já vai falar com você. 🏡")).toBe(true);
  });
  it("esconde a boas-vindas do anúncio com o nome do 1º corretor (lead pode ter passado pro próximo)", () => {
    expect(ehAvisoDaFila("Olá! 👋 Recebemos seu contato e você será atendido pelo nosso especialista *Marina Lacombe*, que já vai falar com você. 🏡")).toBe(true);
    expect(ehAvisoDaFila("Olá, Ana! 👋 Recebemos seu cadastro sobre o *DUET*. Você será atendido pelo nosso especialista *Marina*, que já vai falar com você por aqui. 🏡")).toBe(true);
  });
  it("não esconde mensagem normal do Kayser/cliente", () => {
    expect(ehAvisoDaFila("Olá, Marlene! Eu sou o *Kayser*...")).toBe(false);
    expect(ehAvisoDaFila("📋 *Sua visita está marcada!*")).toBe(false);
    expect(ehAvisoDaFila(null)).toBe(false);
  });
});
