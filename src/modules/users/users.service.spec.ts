import { UsersService } from "./users.service";
import { UserRole } from "./user.entity";

describe("UsersService.updateSelf", () => {
  let repo: any;
  let service: UsersService;

  beforeEach(() => {
    repo = { findOneOrFail: jest.fn(), save: jest.fn(async (u: any) => u) };
    service = new UsersService(repo);
  });

  it("atualiza nome, telefone e avatar do próprio usuário", async () => {
    const user: any = { id: "u1", name: "Antigo", role: UserRole.CORRETOR, passwordHash: "x" };
    repo.findOneOrFail.mockResolvedValue(user);

    const res: any = await service.updateSelf("u1", { name: "Novo Nome", avatar: "data:image/png;base64,AAA" });

    expect(res.name).toBe("Novo Nome");
    expect(res.avatar).toBe("data:image/png;base64,AAA");
    expect(res.passwordHash).toBeUndefined();
  });

  it("não altera papel nem e-mail (campos não pessoais são ignorados)", async () => {
    const user: any = { id: "u1", name: "Ana", email: "ana@a", role: UserRole.CORRETOR, passwordHash: "x" };
    repo.findOneOrFail.mockResolvedValue(user);

    await service.updateSelf("u1", { name: "Ana Maria", ...( { role: UserRole.DIRETOR, email: "hack@x" } as any) });

    expect(user.role).toBe(UserRole.CORRETOR);
    expect(user.email).toBe("ana@a");
    expect(user.name).toBe("Ana Maria");
  });
});
