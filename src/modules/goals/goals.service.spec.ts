import { GoalsService } from "./goals.service";
import { UserRole } from "../users/user.entity";

describe("GoalsService", () => {
  let goalsRepo: any;
  let leadsRepo: any;
  let users: any;
  let service: GoalsService;

  beforeEach(() => {
    goalsRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: "g1", ...x })),
      remove: jest.fn(),
    };
    leadsRepo = { count: jest.fn() };
    users = { getScopeIds: jest.fn().mockResolvedValue(null) };
    service = new GoalsService(goalsRepo, leadsRepo, users);
  });

  it("cria uma nova meta quando não existe", async () => {
    goalsRepo.findOne.mockResolvedValue(null);
    const res = await service.upsert({ userId: "u1", month: 6, year: 2026, targetSales: 10 });
    expect(goalsRepo.create).toHaveBeenCalled();
    expect(res.targetSales).toBe(10);
  });

  it("atualiza a meta existente sem duplicar", async () => {
    const existing: any = { id: "g1", userId: "u1", month: 6, year: 2026, targetSales: 5, targetVisits: 0 };
    goalsRepo.findOne.mockResolvedValue(existing);
    await service.upsert({ userId: "u1", month: 6, year: 2026, targetSales: 12 });
    expect(goalsRepo.create).not.toHaveBeenCalled();
    expect(existing.targetSales).toBe(12);
  });

  it("corretor só vê a própria meta", async () => {
    users.getScopeIds.mockResolvedValue(["c1"]);
    await service.findAll({ id: "c1", role: UserRole.CORRETOR } as any, 6, 2026);
    const arg = goalsRepo.find.mock.calls[0][0];
    // userId vira um operador In(["c1"]) quando há escopo de equipe.
    expect((arg.where.userId as any).value).toEqual(["c1"]);
  });

  it("calcula o progresso com vendas e visitas reais", async () => {
    goalsRepo.find.mockResolvedValue([
      { id: "g1", userId: "u1", month: 6, year: 2026, targetSales: 10, targetVisits: 20, user: { name: "Ana" } },
    ]);
    leadsRepo.count.mockResolvedValueOnce(5).mockResolvedValueOnce(10); // vendas, visitas

    const progress = await service.getProgress({ id: "u1", role: UserRole.DIRETOR } as any, 6, 2026);

    expect(progress[0].achievedSales).toBe(5);
    expect(progress[0].salesPct).toBe(50);
    expect(progress[0].visitsPct).toBe(50);
  });
});
