import { AutomationService } from "./automation.service";
import { Settings } from "../settings/settings.entity";

describe("AutomationService.buildMessage", () => {
  // buildMessage não usa os repositórios/serviços, só o objeto settings.
  const service = new AutomationService(null as any, null as any, null as any, null as any);
  const baseSettings = { followupMsgManha: null, followupMsgTarde: null, followupMsgNoite: null } as unknown as Settings;

  const at = (hour: number) => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 0, 1, hour, 0, 0));
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
});
