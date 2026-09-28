import { AutomationService, primeiroNome, horaBrasilia } from "./automation.service";
import { Settings } from "../settings/settings.entity";

describe("AutomationService.buildMessage", () => {
  // buildMessage não usa os repositórios/serviços, só o objeto settings.
  const service = new AutomationService(null as any, null as any, null as any, null as any);
  const baseSettings = { followupMsgManha: null, followupMsgTarde: null, followupMsgNoite: null } as unknown as Settings;

  // Hora de BRASÍLIA (UTC-3, sem horário de verão) — o servidor roda em UTC.
  const at = (hour: number) => {
    jest.useFakeTimers().setSystemTime(new Date(Date.UTC(2026, 0, 1, hour + 3, 0, 0)));
  };
  afterEach(() => jest.useRealTimers());

  it("usa saudação de manhã (<12h) com {nome} = primeiro nome", () => {
    at(9);
    const msg = service.buildMessage(baseSettings, "Maria Silva");
    expect(msg).toContain("Oi Maria, bom dia!");
    expect(msg).not.toContain("{nome}");
  });

  it("usa saudação de tarde (12–17h)", () => {
    at(15);
    expect(service.buildMessage(baseSettings, "João")).toContain("boa tarde!");
  });

  it("usa saudação de noite (>=18h)", () => {
    at(20);
    expect(service.buildMessage(baseSettings, "Ana")).toContain("boa noite!");
  });

  it("respeita o texto personalizado do Diretor", () => {
    at(9);
    const s = { followupMsgManha: "Bom dia {nome}, tudo bem?" } as unknown as Settings;
    expect(service.buildMessage(s, "Carlos Lima")).toBe("Bom dia Carlos, tudo bem?");
  });

  it("limpa a vírgula solta quando o lead não tem nome", () => {
    at(9);
    const msg = service.buildMessage(baseSettings, "");
    expect(msg).toContain("Oi, bom dia!");
    expect(msg).not.toContain("Oi ,");
  });

  it("lead cadastrado com o NÚMERO não vira 'Oi 5521...'", () => {
    at(9);
    const msg = service.buildMessage(baseSettings, "5521988205917");
    expect(msg).toContain("Oi, bom dia!");
    expect(msg).not.toMatch(/\d{8}/);
  });
});

describe("primeiroNome (nome do cliente no follow-up)", () => {
  it("usa o nome do cadastro e ajusta a caixa", () => {
    expect(primeiroNome("RODRIGO SILVA")).toBe("Rodrigo");
    expect(primeiroNome("maria josé")).toBe("Maria");
    expect(primeiroNome("Édson Carlos")).toBe("Édson");
  });
  it("cadastro com número ou 'Contato WhatsApp' → usa o nome do perfil do WhatsApp", () => {
    expect(primeiroNome("5521988205917", "Carol Souza")).toBe("Carol");
    expect(primeiroNome("Contato WhatsApp", "ana 🌸")).toBe("Ana");
  });
  it("sem nome aproveitável → vazio", () => {
    expect(primeiroNome("5521988205917", "")).toBe("");
    expect(primeiroNome(null, "🙂")).toBe("");
  });
});

describe("horaBrasilia", () => {
  it("12h UTC = 9h em Brasília", () => {
    expect(horaBrasilia(new Date(Date.UTC(2026, 8, 28, 12, 0, 0)))).toBe(9);
  });
});

describe("follow-up: lead manual só se o DIRETOR cadastrou", () => {
  it("deixa anúncio/WhatsApp e só os manuais criados por Diretor", async () => {
    const leads: any[] = [
      { id: "a", source: "anuncio" },
      { id: "w", source: "whatsapp" },
      { id: "mD", source: "manual" },
      { id: "mC", source: "manual" },
      { id: "mX", source: "manual" }, // sem registro de quem criou → fora
    ];
    const manager = {
      getRepository: (ent: any) =>
        ent.name === "User"
          ? { find: async () => [{ id: "diretor1" }] }
          : { find: async () => [{ leadId: "mD", userId: "diretor1" }, { leadId: "mC", userId: "corretor9" }] },
    };
    const svc = new AutomationService({ manager } as any, null as any, null as any, null as any);
    const ficam = await (svc as any).soManuaisDoDiretor(leads);
    expect(ficam.map((l: any) => l.id)).toEqual(["a", "w", "mD"]);
  });
});
