import { DashboardService } from "./dashboard.service";
import { LeadStatus } from "../leads/lead.entity";

// Cards do painel clicáveis + números reais (09/11): tendência de hoje e tempo até o 1º contato.
describe("Painel: cards funcionais (09/11)", () => {
  function montar(contagens: number[], tempoRow: any = { minutos: "42.4", leads: "7" }) {
    const counts = [...contagens];
    const leadsRepo: any = {
      count: jest.fn(async () => counts.shift() ?? 0),
      query: jest.fn(async () => [tempoRow]),
      findAndCount: jest.fn(async () => [[{ id: "L1", name: "Ana", phone: "5521", whatsapp: null, status: LeadStatus.NOVO_LEAD, responsavel: { name: "Bia" }, createdAt: new Date(), lastContactAt: null }], 1]),
    };
    const users: any = { getScopeIds: jest.fn(async () => null) };
    const svc = new DashboardService(leadsRepo, {} as any, {} as any, users);
    return { svc, leadsRepo };
  }

  it("tendência compara hoje com ontem até a mesma hora (não é mais fixa)", async () => {
    // hoje, semana, mês, visitas, vendas, semAtend, semContato, ontem
    const { svc } = montar([6, 10, 100, 1, 1, 0, 3, 4]);
    const m = await svc.getMetrics({ id: "d" } as any);
    expect(m.leadsOntem).toBe(4);
    expect(m.tendenciaHoje).toBe(50);
  });

  it("sem lead ontem, não inventa tendência", async () => {
    const { svc } = montar([3, 3, 3, 0, 0, 0, 0, 0]);
    const m = await svc.getMetrics({ id: "d" } as any);
    expect(m.tendenciaHoje).toBeNull();
  });

  it("tempo médio vem das mensagens da equipe; sem resposta nenhuma fica vazio", async () => {
    const a = montar([0, 0, 0, 0, 0, 0, 0, 0]);
    expect((await a.svc.getMetrics({ id: "d" } as any)).tempoMedioMin).toBe(42);
    const b = montar([0, 0, 0, 0, 0, 0, 0, 0], { minutos: null, leads: "0" });
    expect((await b.svc.getMetrics({ id: "d" } as any)).tempoMedioMin).toBeNull();
  });

  it("lista do card devolve os leads e o total; tipo desconhecido volta vazio", async () => {
    const { svc, leadsRepo } = montar([]);
    const r = await svc.getLista({ id: "d" } as any, "semContato");
    expect(r.total).toBe(1);
    expect(r.items[0]).toMatchObject({ id: "L1", nome: "Ana", phone: "5521", responsavel: "Bia" });
    expect(leadsRepo.findAndCount).toHaveBeenCalledTimes(1);
    expect(await svc.getLista({ id: "d" } as any, "xyz")).toEqual({ total: 0, items: [] });
  });
});
