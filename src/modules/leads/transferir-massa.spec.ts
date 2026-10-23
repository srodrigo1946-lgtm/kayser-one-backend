import { LeadsService } from "./leads.service";
import { UserRole } from "../users/user.entity";

// Transferência em massa (Rodrigo 23/10): Diretor tudo; gestor só no time; corretor nada.
function montar(scope: string[] | null, leads: any[]) {
  const updates: any[] = [];
  const convUpdates: any[] = [];
  const logs: any[] = [];
  const usuarios = [
    { id: "d1", name: "Diretor", active: true },
    { id: "g1", name: "Gerente", active: true },
    { id: "c1", name: "Ana", active: true },
    { id: "c2", name: "Bia", active: true },
    { id: "x9", name: "De fora", active: true },
  ];
  const leadsRepo: any = {
    find: async () => leads,
    update: async (w: any, d: any) => updates.push({ w, d }),
    manager: {
      getRepository: () => ({
        findOne: async ({ where }: any) => usuarios.find((u) => u.id === where.id) ?? null,
        find: async () => usuarios,
      }),
    },
  };
  const convRepo: any = { update: async (w: any, d: any) => convUpdates.push({ w, d }) };
  const history: any = { log: async (x: any) => logs.push(x) };
  const users: any = { getScopeIds: async () => scope };
  const s = new LeadsService(leadsRepo, convRepo, {} as any, history, users, { get: () => undefined } as any);
  return { s, updates, convUpdates, logs };
}

describe("Transferência de leads em massa", () => {
  it("corretor não transfere", async () => {
    const { s } = montar(["c1"], [{ id: "l1", responsavelId: "c1" }]);
    await expect(s.transferirEmMassa(["l1"], "c2", { id: "c1", role: UserRole.CORRETOR } as any)).rejects.toThrow("Corretor");
  });

  it("gestor não manda pra fora do time nem pega lead de fora", async () => {
    const g = { id: "g1", role: UserRole.GERENTE, name: "Gerente" } as any;
    const a = montar(["g1", "c1", "c2"], [{ id: "l1", responsavelId: "c1" }]);
    await expect(a.s.transferirEmMassa(["l1"], "x9", g)).rejects.toThrow("sua equipe");
    const b = montar(["g1", "c1", "c2"], [{ id: "l1", responsavelId: "x9" }]);
    await expect(b.s.transferirEmMassa(["l1"], "c2", g)).rejects.toThrow("fora da sua equipe");
  });

  it("gestor transfere dentro do time: muda responsável, conversa, aviso e histórico", async () => {
    const g = { id: "g1", role: UserRole.GERENTE, name: "Gerente" } as any;
    const { s, updates, convUpdates, logs } = montar(["g1", "c1", "c2"], [
      { id: "l1", responsavelId: "c1" },
      { id: "l2", responsavelId: "c2" }, // já é da Bia: não conta
    ]);
    const r = await s.transferirEmMassa(["l1", "l2"], "c2", g);
    expect(r).toEqual({ transferidos: 1 });
    expect(updates[0].d).toEqual(expect.objectContaining({ responsavelId: "c2", transferidoPorId: "g1", transferidoEm: expect.any(Date) }));
    expect(convUpdates[0].d).toEqual({ assignedToId: "c2" });
    expect(logs[0].description).toContain("de Ana para Bia por Gerente");
  });

  it("Diretor transfere qualquer lead pra qualquer um", async () => {
    const { s } = montar(null, [{ id: "l1", responsavelId: "x9" }, { id: "l2", responsavelId: null }]);
    const r = await s.transferirEmMassa(["l1", "l2"], "c1", { id: "d1", role: UserRole.DIRETOR, name: "Diretor" } as any);
    expect(r).toEqual({ transferidos: 2 });
  });
});
