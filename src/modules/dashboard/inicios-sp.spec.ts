import { iniciosSP } from "./dashboard.service";

describe("painel: hoje/semana/mês no horário de Brasília", () => {
  it("às 22h de SP (01h UTC do dia seguinte) o 'hoje' ainda é o dia de SP", () => {
    const { dia, semana, mes } = iniciosSP(new Date("2026-11-03T01:00:00Z")); // 02/11 22h em SP
    expect(dia.toISOString()).toBe("2026-11-02T03:00:00.000Z");
    expect(semana.toISOString()).toBe("2026-11-01T03:00:00.000Z"); // domingo 01/11
    expect(mes.toISOString()).toBe("2026-11-01T03:00:00.000Z");
  });
});
