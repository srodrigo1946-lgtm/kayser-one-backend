import { EscalaService } from "./escala.service";
import { EscalaTurno } from "./escala-turno.entity";

// Grade mínima: segunda (dia 1) com 3 turnos Seg-Sex e sábado (dia 6) manhã.
function grade(): EscalaTurno[] {
  const mk = (d: number, t: number, hi: string, hf: string, ids: string[] = []) =>
    ({ id: `${d}-${t}`, diaSemana: d, turno: t, horaInicio: hi, horaFim: hf, atendenteIds: ids } as EscalaTurno);
  return [
    mk(1, 0, "09:00", "13:00", ["A"]),
    mk(1, 1, "13:00", "17:00", ["B"]),
    mk(1, 2, "17:00", "21:00", []),
    mk(6, 0, "09:00", "12:00", ["C"]),
  ];
}

function svc(rows: EscalaTurno[]) {
  const repo: any = {
    find: jest.fn(async ({ where }: any = {}) =>
      where?.diaSemana !== undefined ? rows.filter((r) => r.diaSemana === where.diaSemana) : rows
    ),
    findOne: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null),
    save: jest.fn(async (x) => x),
    create: jest.fn((x) => x),
    count: jest.fn(async () => rows.length),
  };
  return { s: new EscalaService(repo), repo };
}

describe("EscalaService.turnoAtivo", () => {
  it("acha o turno da tarde numa segunda 14h", async () => {
    const { s } = svc(grade());
    const seg14 = new Date("2026-08-17T14:00:00"); // 2026-08-17 é segunda
    const t = await s.turnoAtivo(seg14);
    expect(t?.atendenteIds).toEqual(["B"]);
  });

  it("retorna null de madrugada (03h)", async () => {
    const { s } = svc(grade());
    expect(await s.turnoAtivo(new Date("2026-08-17T03:00:00"))).toBeNull();
  });

  it("borda: 13:00 cai no turno da tarde, não no da manhã", async () => {
    const { s } = svc(grade());
    const t = await s.turnoAtivo(new Date("2026-08-17T13:00:00"));
    expect(t?.turno).toBe(1);
  });

  it("fim de semana usa a faixa de sábado (até 12h)", async () => {
    const { s } = svc(grade());
    const sab10 = new Date("2026-08-22T10:00:00"); // 2026-08-22 é sábado
    expect((await s.turnoAtivo(sab10))?.atendenteIds).toEqual(["C"]);
    const sab13 = new Date("2026-08-22T13:00:00"); // fora do turno da manhã do sábado
    expect(await s.turnoAtivo(sab13)).toBeNull();
  });
});

describe("EscalaService.setAtendentes", () => {
  it("atualiza os atendentes de um turno", async () => {
    const { s } = svc(grade());
    const r = await s.setAtendentes("1-2", ["X", "Y"]);
    expect(r.atendenteIds).toEqual(["X", "Y"]);
  });
});
