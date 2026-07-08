import { WhatsappFlowService } from "./whatsapp-flow.service";

describe("WhatsappFlowService.parseEvolutionMessage", () => {
  let service: WhatsappFlowService;

  beforeEach(() => {
    // Dependências não são usadas no parsing — mocks vazios bastam.
    service = new WhatsappFlowService({} as any, {} as any, {} as any, {} as any);
  });

  const parse = (payload: any) => (service as any).parseEvolutionMessage(payload);

  it("extrai texto e número de uma mensagem recebida (conversation)", () => {
    const r = parse({
      instance: "user_1",
      data: { key: { remoteJid: "5511999998888@s.whatsapp.net", fromMe: false }, message: { conversation: "Olá!" } },
    });
    expect(r).toEqual({
      remoteJid: "5511999998888",
      remoteJidFull: "5511999998888@s.whatsapp.net",
      isGroup: false,
      text: "Olá!",
      mediaType: null,
      fromMe: false,
      pushName: "",
      instanceName: "user_1",
    });
  });

  it("suporta extendedTextMessage", () => {
    const r = parse({
      data: { key: { remoteJid: "5511@s.whatsapp.net", fromMe: false }, message: { extendedTextMessage: { text: "oi" } } },
    });
    expect(r.text).toBe("oi");
  });

  it("marca fromMe corretamente (mensagem enviada por nós)", () => {
    const r = parse({
      data: { key: { remoteJid: "5511@s.whatsapp.net", fromMe: true }, message: { conversation: "resposta" } },
    });
    expect(r.fromMe).toBe(true);
  });

  it("retorna null quando não há remoteJid", () => {
    expect(parse({ data: { key: {}, message: { conversation: "x" } } })).toBeNull();
  });

  it("aceita payload com data em array", () => {
    const r = parse({
      data: [{ key: { remoteJid: "5511@s.whatsapp.net", fromMe: false }, message: { conversation: "array" } }],
    });
    expect(r.text).toBe("array");
  });
});
