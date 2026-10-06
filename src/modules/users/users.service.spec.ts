import { UsersService } from "./users.service";
import { UserRole } from "./user.entity";
import { ForbiddenException, BadRequestException } from "@nestjs/common";

describe("UsersService", () => {
  let repo: any;
  let storage: any;
  let service: UsersService;

  beforeEach(() => {
    repo = {
      findOneOrFail: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(async (u: any) => u),
      query: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue({}),
    };
    storage = { isEnabled: false, upload: jest.fn(), getObject: jest.fn() };
    service = new UsersService(repo, storage);
  });

  const diretor: any = { id: "d1", role: UserRole.DIRETOR };

  it("updateSelf atualiza nome/telefone do próprio usuário sem expor o hash", async () => {
    const user: any = { id: "u1", name: "Antigo", role: UserRole.CORRETOR, passwordHash: "x" };
    repo.findOneOrFail.mockResolvedValue(user);

    const res: any = await service.updateSelf("u1", { name: "Novo Nome", phone: "11999" });

    expect(res.name).toBe("Novo Nome");
    expect(res.phone).toBe("11999");
    expect(res.passwordHash).toBeUndefined();
  });

  it("updateSelf não altera papel nem e-mail", async () => {
    const user: any = { id: "u1", name: "Ana", email: "ana@a", role: UserRole.CORRETOR, passwordHash: "x" };
    repo.findOneOrFail.mockResolvedValue(user);

    await service.updateSelf("u1", { name: "Ana Maria", ...({ role: UserRole.DIRETOR, email: "hack@x" } as any) });

    expect(user.role).toBe(UserRole.CORRETOR);
    expect(user.email).toBe("ana@a");
  });

  it("setAvatar guarda data URI quando o MinIO está desativado", async () => {
    const user: any = { id: "u1", passwordHash: "x" };
    repo.findOneOrFail.mockResolvedValue(user);
    const file: any = { mimetype: "image/png", buffer: Buffer.from("abc"), originalname: "foto.png" };

    await service.setAvatar("u1", file);

    expect(user.avatar.startsWith("data:image/png;base64,")).toBe(true);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("setAvatar envia ao MinIO quando habilitado", async () => {
    storage.isEnabled = true;
    storage.upload.mockResolvedValue("avatars/u1-123.png");
    const user: any = { id: "u1", passwordHash: "x" };
    repo.findOneOrFail.mockResolvedValue(user);
    const file: any = { mimetype: "image/png", buffer: Buffer.from("abc"), originalname: "foto.png" };

    await service.setAvatar("u1", file);

    expect(storage.upload).toHaveBeenCalled();
    expect(user.avatar).toBe("avatars/u1-123.png");
  });

  it("getAvatar decodifica um data URI", async () => {
    repo.findOne.mockResolvedValue({ id: "u1", avatar: `data:image/png;base64,${Buffer.from("xyz").toString("base64")}` });
    const out = await service.getAvatar("u1");
    expect(out?.contentType).toBe("image/png");
    expect(out?.buffer.toString()).toBe("xyz");
  });

  it("setAvatar rejeita arquivo que não é imagem", async () => {
    repo.findOneOrFail.mockResolvedValue({ id: "u1" });
    const file: any = { mimetype: "application/pdf", buffer: Buffer.from("x"), originalname: "a.pdf" };
    await expect(service.setAvatar("u1", file)).rejects.toBeTruthy();
  });

  it("hardRemove: só o Diretor pode excluir (corretor → 403)", async () => {
    await expect(service.hardRemove("x", { id: "c1", role: UserRole.CORRETOR } as any)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("hardRemove: não exclui a si mesmo", async () => {
    repo.findOne.mockResolvedValue({ id: "d1", role: UserRole.DIRETOR });
    await expect(service.hardRemove("d1", diretor)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("hardRemove: não exclui outro Diretor", async () => {
    repo.findOne.mockResolvedValue({ id: "d2", role: UserRole.DIRETOR });
    await expect(service.hardRemove("d2", diretor)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("hardRemove: Diretor exclui um corretor (solta referências + delete)", async () => {
    repo.findOne.mockResolvedValue({ id: "c9", role: UserRole.CORRETOR });
    await service.hardRemove("c9", diretor);
    expect(repo.query).toHaveBeenCalled(); // soltou refs (leads/conversas/pastas/gestor)
    expect(repo.delete).toHaveBeenCalledWith({ id: "c9" });
  });
});

describe("UsersService.tornarCorretor", () => {
  const montar = (lista: any[]) => {
    const updates: any[] = [];
    const repo: any = {
      findOne: async ({ where }: any) => lista.find((u) => u.id === where.id) ?? null,
      find: async ({ where }: any) => lista.filter((u) => u.managerId === where.managerId),
      update: async (crit: any, d: any) => updates.push({ crit, d }),
    };
    return { s: new UsersService(repo, {} as any), updates };
  };
  const diretor = { id: "D", role: "diretor" } as any;

  it("gerente vira corretor e o time dele passa pro Diretor", async () => {
    const { s, updates } = montar([
      { id: "G", name: "Gerente Ana", role: "gerente", managerId: "GG" },
      { id: "c1", role: "corretor", managerId: "G" },
      { id: "c2", role: "corretor", managerId: "G" },
    ]);
    const r = await s.tornarCorretor("G", diretor);
    expect(r.timeMovido).toBe(2);
    expect(updates).toContainEqual({ crit: { managerId: "G" }, d: { managerId: "D" } });
    expect(updates).toContainEqual({ crit: "G", d: { role: "corretor", managerId: "GG" } });
  });

  it("só o Diretor faz; corretor/Diretor não mudam", async () => {
    const { s } = montar([{ id: "c1", role: "corretor" }, { id: "D2", role: "diretor" }]);
    await expect(s.tornarCorretor("c1", { id: "G", role: "gerente" } as any)).rejects.toThrow("Só o Diretor");
    await expect(s.tornarCorretor("c1", diretor)).rejects.toThrow("Já é corretor");
    await expect(s.tornarCorretor("D2", diretor)).rejects.toThrow("Diretor");
  });
});

describe("UsersService.update (escopo e cargo)", () => {
  // Árvore: D (diretor) > S (superintendente) > c1 ; c2 responde direto ao D (fora do time de S)
  const lista = () => [
    { id: "D", role: "diretor", managerId: null },
    { id: "S", role: "superintendente", managerId: "D" },
    { id: "c1", role: "corretor", managerId: "S" },
    { id: "c2", role: "corretor", managerId: "D" },
  ];
  const montar = () => {
    const users = lista();
    const repo: any = {
      findOneOrFail: async ({ where }: any) => users.find((u) => u.id === where.id),
      find: async () => users,
      save: async (u: any) => u,
    };
    return new UsersService(repo, {} as any);
  };
  const diretor = { id: "D", role: "diretor" } as any;
  const sup = { id: "S", role: "superintendente" } as any;

  it("Diretor troca o chefe de qualquer um (seletor de chefe)", async () => {
    const r: any = await montar().update("c2", { managerId: "S" } as any, diretor);
    expect(r.managerId).toBe("S");
  });
  it("ninguém vira Diretor por aqui, nem pelo Diretor", async () => {
    await expect(montar().update("c1", { role: "diretor" } as any, diretor)).rejects.toThrow("Diretor");
  });
  it("gestor edita quem é do time dele", async () => {
    const r: any = await montar().update("c1", { name: "Novo" } as any, sup);
    expect(r.name).toBe("Novo");
  });
  it("gestor não edita fora do time nem a si mesmo", async () => {
    await expect(montar().update("c2", { name: "x" } as any, sup)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(montar().update("S", { name: "x" } as any, sup)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it("gestor não muda cargo nem tira a pessoa do time", async () => {
    await expect(montar().update("c1", { role: "gerente" } as any, sup)).rejects.toThrow("Só o Diretor");
    await expect(montar().update("c1", { managerId: "D" } as any, sup)).rejects.toThrow("equipe");
    await expect(montar().update("c1", { managerId: null } as any, sup)).rejects.toThrow("equipe");
  });
});

describe("UsersService.tornarGestor", () => {
  const montar = (lista: any[]) => {
    const updates: any[] = [];
    const repo: any = { findOne: async ({ where }: any) => lista.find((u) => u.id === where.id) ?? null, update: async (id: any, d: any) => updates.push({ id, d }) };
    return { s: new UsersService(repo, {} as any), updates };
  };
  const diretor = { id: "D", role: "diretor" } as any;
  it("corretor vira gerente mantendo o chefe", async () => {
    const { s, updates } = montar([{ id: "c1", name: "Ana", role: "corretor", managerId: "G" }]);
    await s.tornarGestor("c1", "gerente", diretor);
    expect(updates).toEqual([{ id: "c1", d: { role: "gerente", managerId: "G" } }]);
  });
  it("não promove a Diretor, nem quem não é corretor, nem empresa parceira", async () => {
    const { s } = montar([{ id: "c1", role: "corretor" }, { id: "g1", role: "gerente" }, { id: "e1", role: "corretor", empresaId: "X" }]);
    await expect(s.tornarGestor("c1", "diretor", diretor)).rejects.toThrow("Cargo inválido");
    await expect(s.tornarGestor("g1", "gerente", diretor)).rejects.toThrow("Só corretor");
    await expect(s.tornarGestor("e1", "gerente", diretor)).rejects.toThrow("parceira");
    await expect(s.tornarGestor("c1", "gerente", { id: "G", role: "gerente" } as any)).rejects.toThrow("Só o Diretor");
  });
});
