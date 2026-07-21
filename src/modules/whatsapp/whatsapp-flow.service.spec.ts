import { WhatsappFlowService } from "./whatsapp-flow.service";

describe("WhatsappFlowService.parseEvolutionMessage", () => {
  let service: WhatsappFlowService;

  beforeEach(() => {
    // Dependências não são usadas no parsing — mocks vazios bastam.
    service = new WhatsappFlowService({} as any, {} as any, {} as any, {} as any, {} as any);
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

  it("extrai origem/campanha do anúncio (referral do Meta)", () => {
    const r = parse({
      instance: "user_diretor",
      data: {
        key: { remoteJid: "5521999999999@s.whatsapp.net", fromMe: false },
        pushName: "Cliente",
        message: {
          conversation: "Oi, vim do anúncio",
          contextInfo: { externalAdReply: { sourceType: "ad", sourceApp: "instagram", title: "Campanha Verão" } },
        },
      },
    });
    expect(r.ad?.platform).toBe("instagram");
    expect(r.ad?.campaign).toBe("Campanha Verão");
  });

  // Formato REAL do click-to-WhatsApp: o externalAdReply vem VAZIO e quem
  // identifica o anúncio é o entryPointConversionSource. Olhar só o
  // externalAdReply preenchido fazia a fila nunca disparar em anúncio de verdade.
  it("detecta anúncio quando externalAdReply vem vazio (entryPointConversionSource=ctwa_ad)", () => {
    const r = parse({
      instance: "user_diretor",
      data: {
        key: { remoteJid: "5521999999999@s.whatsapp.net", fromMe: false },
        pushName: "Cliente",
        message: {
          conversation: "Oi, vi o anúncio",
          contextInfo: {
            externalAdReply: {},
            entryPointConversionSource: "ctwa_ad",
            entryPointConversionApp: "facebook",
            ctwaPayload: "campanha-lancamento",
          },
        },
      },
    });
    expect(r.ad?.platform).toBe("facebook");
    expect(r.ad?.campaign).toBe("campanha-lancamento");
  });

  it("detecta anúncio mesmo SEM externalAdReply nenhum", () => {
    const r = parse({
      instance: "user_diretor",
      data: {
        key: { remoteJid: "5521999999999@s.whatsapp.net", fromMe: false },
        message: {
          conversation: "Oi",
          contextInfo: { entryPointConversionSource: "ctwa_ad", entryPointConversionApp: "instagram" },
        },
      },
    });
    expect(r.ad?.platform).toBe("instagram");
  });

  it("NÃO marca como anúncio uma mensagem comum com contextInfo (resposta citada)", () => {
    const r = parse({
      instance: "user_diretor",
      data: {
        key: { remoteJid: "5521999999999@s.whatsapp.net", fromMe: false },
        message: {
          extendedTextMessage: {
            text: "respondendo",
            contextInfo: { stanzaId: "ABC", participant: "5521988887777@s.whatsapp.net" },
          },
        },
      },
    });
    expect(r.ad).toBeUndefined();
  });
});
