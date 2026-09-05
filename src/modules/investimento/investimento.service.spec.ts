import { InvestimentoService } from "./investimento.service";

function make(opts: { dias?: any[]; mensal?: any; verifyToken?: string } = {}) {
  const savedDays: any[] = [];
  const repo: any = {
    findOne: jest.fn(async () => opts.mensal ?? null),
    find: jest.fn(async () => (opts.mensal ? [opts.mensal] : [])),
    create: jest.fn((v) => v),
    save: jest.fn(async (v) => v),
  };
  const dayRepo: any = {
    find: jest.fn(async () => opts.dias ?? []),
    findOne: jest.fn(async () => null),
    create: jest.fn((v) => ({ ...v })),
    save: jest.fn(async (v) => { savedDays.push(v); return v; }),
  };
  const settings: any = { get: jest.fn(async () => ({ metaVerifyToken: opts.verifyToken ?? "tok" })) };
  const config: any = { get: jest.fn(() => undefined) };
  return { svc: new InvestimentoService(repo, dayRepo, settings, config), savedDays };
}

describe("InvestimentoService", () => {
  it("get do mês: soma os dias quando existem (ignora o mensal)", async () => {
    const { svc } = make({ dias: [{ dia: 1, valor: 100 }, { dia: 2, valor: 50 }], mensal: { valor: 999 } });
    expect((await svc.get(2026, 9)).valor).toBe(150);
  });

  it("get do mês: cai no valor mensal quando não há dias", async () => {
    const { svc } = make({ dias: [], mensal: { valor: 300 } });
    expect((await svc.get(2026, 9)).valor).toBe(300);
  });

  it("setDayDireto grava com token certo e origem facebook", async () => {
    const { svc, savedDays } = make({ verifyToken: "tok" });
    const r = await svc.setDayDireto("tok", { ano: 2026, mes: 9, dia: 5, valor: 200 });
    expect(r.ok).toBe(true);
    expect(savedDays[0]).toMatchObject({ ano: 2026, mes: 9, dia: 5, valor: 200, fonte: "facebook" });
  });

  it("setDayDireto aceita date YYYY-MM-DD", async () => {
    const { svc, savedDays } = make({ verifyToken: "tok" });
    await svc.setDayDireto("tok", { date: "2026-09-07", valor: 120 });
    expect(savedDays[0]).toMatchObject({ ano: 2026, mes: 9, dia: 7, valor: 120 });
  });

  it("setDayDireto recusa token errado", async () => {
    const { svc } = make({ verifyToken: "tok" });
    expect((await svc.setDayDireto("errado", { ano: 2026, mes: 9, dia: 5, valor: 200 })).ok).toBe(false);
  });
});
