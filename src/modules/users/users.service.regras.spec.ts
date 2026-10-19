import { UsersService } from "./users.service";
import { UserRole } from "./user.entity";

// Regras da auditoria 19/10: cada cargo só vê e mexe no próprio time; só o Diretor cria Diretor.
describe("UsersService — cada cargo só no próprio time", () => {
  const todos = [
    { id: "dir", managerId: null },
    { id: "sup", managerId: "dir" },
    { id: "g1", managerId: "sup" },
    { id: "c1", managerId: "g1" },
    { id: "g2", managerId: "dir" },
    { id: "c2", managerId: "g2" },
  ];
  const repo: any = {
    find: async () => todos,
    findOne: async ({ where }: any) =>
      where.email ? null : todos.find((u) => u.id === where.id) && { ...todos.find((u) => u.id === where.id), approved: where.id !== "pend" },
    create: (x: any) => x,
    save: async (x: any) => ({ id: "novo", ...x }),
    remove: async () => null,
  };
  const s = new UsersService(repo, {} as any);
  const sup: any = { id: "sup", role: UserRole.SUPERINTENDENTE };
  const dir: any = { id: "dir", role: UserRole.DIRETOR };

  it("superintendente não cria Diretor", async () => {
    await expect(s.create({ email: "a@b.com", name: "A", role: UserRole.DIRETOR } as any, sup)).rejects.toThrow(/Só o Diretor/);
  });

  it("superintendente não pendura gente fora do time dele", async () => {
    await expect(s.create({ email: "a@b.com", name: "A", role: UserRole.CORRETOR, managerId: "g2" } as any, sup)).rejects.toThrow(/seu time/);
  });

  it("superintendente cria corretor no próprio time (sem chefe = ele mesmo)", async () => {
    const r: any = await s.create({ email: "a@b.com", name: "A", role: UserRole.CORRETOR } as any, sup);
    expect(r.managerId).toBe("sup");
  });

  it("Diretor pode criar Diretor", async () => {
    await expect(s.create({ email: "a@b.com", name: "A", role: UserRole.DIRETOR } as any, dir)).resolves.toBeTruthy();
  });

  it("não vê usuário de outro time; vê o do próprio", async () => {
    await expect(s.findOne("c2", sup)).rejects.toThrow(/não encontrado/);
    await expect(s.findOne("c1", sup)).resolves.toBeTruthy();
    await expect(s.findOne("c2", dir)).resolves.toBeTruthy();
  });

  it("recusar não apaga quem já foi aprovado", async () => {
    await expect(s.reject("c1", sup)).rejects.toThrow(/já foi aprovado/);
  });
});
