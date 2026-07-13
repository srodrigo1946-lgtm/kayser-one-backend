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
      aiApiKey: "sk-secreta",
      firstLogin: true,
      active: true,
      approved: true,
    });

    const res = await service.login({ email: "rodrigo@kayserone.com.br", password: "123456789" } as any);

    expect(res.accessToken).toBe("token-123");
    expect(res.firstLogin).toBe(true);
    // Nunca expõe credenciais sensíveis ao front.
    expect((res.user as any).passwordHash).toBeUndefined();
    expect((res.user as any).aiApiKey).toBeUndefined();
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

  it("recupera a senha do Diretor com e-mail + código corretos", async () => {
    const recoveryCodeHash = await bcrypt.hash("meucodigo", 4);
    const user: any = { id: "d1", email: "diretor@x.com", role: "diretor", recoveryCodeHash };
    repo.findOne.mockResolvedValue(user);
    repo.save.mockImplementation(async (u: any) => u);

    const res = await service.recover({ email: "diretor@x.com", recoveryCode: "meucodigo", newPassword: "novaSenha123" });
    expect(res.message).toMatch(/redefinida/i);
    expect(user.firstLogin).toBe(false);
    expect(user.passwordHash).toBeTruthy();
  });

  it("recover: erro genérico com código errado", async () => {
    const recoveryCodeHash = await bcrypt.hash("certo", 4);
    repo.findOne.mockResolvedValue({ id: "d1", role: "diretor", recoveryCodeHash });
    await expect(
      service.recover({ email: "d@x", recoveryCode: "errado", newPassword: "novaSenha123" })
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("recover: erro genérico se não for Diretor", async () => {
    repo.findOne.mockResolvedValue({ id: "c1", role: "corretor", recoveryCodeHash: "x" });
    await expect(
      service.recover({ email: "c@x", recoveryCode: "qualquer", newPassword: "novaSenha123" })
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
