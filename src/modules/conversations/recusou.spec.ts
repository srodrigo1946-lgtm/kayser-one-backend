import { recusou, OFERECEU_SAIR } from "./conversations.service";

describe("Cliente respondeu NÃO à oferta de sair", () => {
  it("recusa clara conta", () => {
    for (const t of ["Não", "NÃO", "Nao", "não obrigado", "Não obrigada 😊", "No momento não quero", "Boa tarde ! Nao tenho interesse", "Não tenho interesse \nJá comprei"])
      expect(recusou(t)).toBe(true);
  });
  it("'não posso' e outras respostas não contam", () => {
    for (const t of ["Não posso.", "Não posso receber ligações", "Sim", "não sei ainda", "Agora não posso falar"]) expect(recusou(t)).toBe(false);
  });
  it("só vale depois da nossa mensagem que oferece sair", () => {
    expect(OFERECEU_SAIR.test("Caso não tenha interesse basta digitar NÃO para sair!")).toBe(true);
    expect(OFERECEU_SAIR.test("(Se não quiser receber, é só responder NÃO.)")).toBe(true);
    expect(OFERECEU_SAIR.test("Oi, tudo bem? Posso te ajudar?")).toBe(false);
  });
});
