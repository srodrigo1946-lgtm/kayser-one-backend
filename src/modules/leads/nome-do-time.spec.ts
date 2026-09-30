import { nomeDoTime } from "./leads.service";

describe("nomeDoTime (planilha dos cargos precisa do time)", () => {
  it("padroniza o nome", () => {
    expect(nomeDoTime("isaac")).toBe("Time Isaac");
    expect(nomeDoTime("time isaac")).toBe("Time Isaac");
    expect(nomeDoTime("  TIME   Isaac  ")).toBe("Time Isaac");
    expect(nomeDoTime("time ângela souza")).toBe("Time Ângela Souza");
  });
  it("Corujão é origem própria (não vira 'Time Corujão')", () => {
    expect(nomeDoTime("corujao")).toBe("Corujão");
    expect(nomeDoTime("Corujão")).toBe("Corujão");
  });
  it("vazio ou só 'Time' não vale", () => {
    expect(nomeDoTime("")).toBe("");
    expect(nomeDoTime("Time ")).toBe("");
    expect(nomeDoTime(undefined)).toBe("");
  });
});
