import { UnauthorizedException } from "@nestjs/common";
import { JwtStrategy } from "./jwt.strategy";
import { versaoSenha } from "../jwt-secret";

describe("JwtStrategy — senha trocada derruba o token", () => {
  const montar = (user: any) => {
    const qb: any = { addSelect: () => qb, where: () => qb, getOne: async () => (user ? { ...user } : null) };
    const repo = { createQueryBuilder: () => qb };
    const config = { get: (k: string) => (k === "JWT_SECRET" ? "teste" : undefined) };
    return new JwtStrategy(config as any, repo as any);
  };
  const user = { id: "u1", name: "Ana", passwordHash: "$2b$12$hash-atual" };

  it("aceita token com a versão da senha atual e não devolve o hash", async () => {
    const u = await montar(user).validate({ sub: "u1", pv: versaoSenha(user.passwordHash) });
    expect(u.id).toBe("u1");
    expect((u as any).passwordHash).toBeUndefined();
  });

  it("recusa token emitido antes da troca de senha", async () => {
    await expect(montar(user).validate({ sub: "u1", pv: versaoSenha("$2b$12$hash-antigo") })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("token antigo sem versão ainda vale (até expirar) e usuário inativo/inexistente não", async () => {
    expect((await montar(user).validate({ sub: "u1" })).id).toBe("u1");
    await expect(montar(null).validate({ sub: "u1" })).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
