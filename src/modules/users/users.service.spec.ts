import { UsersService } from "./users.service";
import { UserRole } from "./user.entity";

describe("UsersService", () => {
  let repo: any;
  let storage: any;
  let service: UsersService;

  beforeEach(() => {
    repo = { findOneOrFail: jest.fn(), findOne: jest.fn(), save: jest.fn(async (u: any) => u) };
    storage = { isEnabled: false, upload: jest.fn(), getObject: jest.fn() };
    service = new UsersService(repo, storage);
  });

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
});
