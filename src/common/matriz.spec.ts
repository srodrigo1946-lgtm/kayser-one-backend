import { NotFoundException } from "@nestjs/common";
import { ehMatriz, SoMatrizGuard } from "./matriz";
import { senhaAleatoria } from "../modules/clientes-saas/clientes-saas.service";

describe("só matriz e senha do 1º acesso", () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; });

  it("matriz = tem RAILWAY_API_TOKEN e não tem LIMITE_USUARIOS", () => {
    process.env.RAILWAY_API_TOKEN = "x"; delete process.env.LIMITE_USUARIOS;
    expect(ehMatriz()).toBe(true);
    process.env.LIMITE_USUARIOS = "16"; // servidor de cliente, mesmo com token por engano
    expect(ehMatriz()).toBe(false);
    expect(() => new SoMatrizGuard().canActivate()).toThrow(NotFoundException);
  });

  it("senha aleatória: 10 caracteres, sem 0/O/1/l/I, muda a cada vez", () => {
    const a = senhaAleatoria(), b = senhaAleatoria();
    expect(a).toHaveLength(10);
    expect(a).not.toMatch(/[0O1lI]/);
    expect(a).not.toBe(b);
  });
});
