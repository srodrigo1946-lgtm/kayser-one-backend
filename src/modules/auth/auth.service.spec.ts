import { UnauthorizedException, BadRequestException } from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { AuthService } from "./auth.service";

jest.setTimeout(30000);

describe("AuthService", () => {
  let repo: any;
  let jwt: any;
  let service: AuthService;

  beforeEach(() => {
    repo = { findOne: jest.fn(), findOneOrFail: jest.fn(), save: jest.fn() };
    jwt = { sign: jest.fn().mockReturnValue("token-123") };
    service = new AuthService(repo, jwt);
  });

  it("autentica com credenciais válidas e não expõe o hash da senha", async () => {
    const passwordHash = await bcrypt.hash("123456789", 4);
    repo.findOne.mockResolvedValue({
      id: "u1",
      email: "rodrigo@kayserone.com.br",
      role: "diretor",
      passwordHash,
      firstLogin: true,
      active: true,
    });

    const res = await service.login({ email: "rodrigo@kayserone.com.br", password: "123456789" } as any);

    expect(res.accessToken).toBe("token-123");
    expect(res.firstLogin).toBe(true);
    expect((res.user as any).passwordHash).toBeUndefined();
  });

  it("rejeita senha incorreta", async () => {
    const passwordHash = await bcrypt.hash("correta", 4);
    repo.findOne.mockResolvedValue({ id: "u1", passwordHash, active: true });

    await expect(
      service.login({ email: "a@a", password: "errada" } as any)
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejeita usuário inexistente", async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(
      service.login({ email: "x@x", password: "qualquer" } as any)
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("não troca a senha quando a atual está incorreta", async () => {
    const passwordHash = await bcrypt.hash("antiga", 4);
    repo.findOneOrFail.mockResolvedValue({ id: "u1", passwordHash });

    await expect(
      service.changePassword("u1", { currentPassword: "errada", newPassword: "novaSenha123" } as any)
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("troca a senha e marca firstLogin como false", async () => {
    const passwordHash = await bcrypt.hash("antiga", 4);
    const user: any = { id: "u1", passwordHash, firstLogin: true };
    repo.findOneOrFail.mockResolvedValue(user);
    repo.save.mockImplementation(async (u: any) => u);

    const res = await service.changePassword("u1", {
      currentPassword: "antiga",
      newPassword: "novaSenha123",
    } as any);

    expect(res.message).toBeTruthy();
    expect(user.firstLogin).toBe(false);
    expect(user.passwordHash).not.toBe(passwordHash);
  });
});
