import { somarGastoPorDia } from "./investimento.service";

describe("Gasto do Meta por dia", () => {
  it("soma as contas no mesmo dia e ignora lixo", () => {
    expect(
      somarGastoPorDia([
        { date_start: "2026-09-01", spend: "100.10" },
        { date_start: "2026-09-01", spend: "20.05" },
        { date_start: "2026-09-02", spend: "50" },
        { date_start: "", spend: "9" },
        { date_start: "2026-09-03", spend: "abc" },
      ])
    ).toEqual({ "2026-09-01": 120.15, "2026-09-02": 50 });
  });
});
