import { slugSubdominio, subdominioValido, PLANOS_SAAS, PLANO_PERSONALIZADO, ClientesSaasService } from "./clientes-saas.service";

describe("Clientes SaaS — subdomínio e planos", () => {
  it("gera subdomínio limpo a partir do nome da empresa", () => {
    expect(slugSubdominio("Imobiliária São João Ltda")).toBe("imobiliariasaojoao");
    expect(slugSubdominio("Casa-Nova Imóveis")).toBe("casa-novaimoveis");
  });

  it("recusa reservados, curtos demais e com caractere inválido", () => {
    expect(subdominioValido("imobx")).toBe(true);
    for (const s of ["www", "demo", "api", "a", "-imob", "imob_x"]) expect(subdominioValido(s)).toBe(false);
  });

  it("planos batem com a página de vendas", () => {
    expect(PLANOS_SAAS).toEqual({ Corretor: 1, "Gerente de Vendas": 16, "Gerente Geral": 57, Superintendente: 120, "Diretor completo": 250 });
  });
});

describe("Clientes SaaS — criação", () => {
  const ENV = ["RAILWAY_API_TOKEN", "RAILWAY_CLIENTES_PROJECT_ID", "RAILWAY_CLIENTES_ENV_ID"];
  afterEach(() => ENV.forEach((k) => delete process.env[k]));
  const repo = (existente: any = null) => ({
    findOne: async () => existente,
    create: (x: any) => x,
    save: async (x: any) => ({ id: "c1", ...x }),
    update: async () => null,
  });

  it("sem as chaves do Railway (instalação de cliente) não cria nada", async () => {
    const s = new ClientesSaasService(repo() as any);
    await expect(s.criar({ empresa: "Imob X", plano: "Corretor", diretorNome: "Ana", diretorEmail: "a@x.com" })).rejects.toThrow(/não configurada/);
  });

  it("valida plano e subdomínio repetido antes de criar", async () => {
    ENV.forEach((k) => (process.env[k] = "x"));
    const s = new ClientesSaasService(repo({ id: "outro" }) as any);
    await expect(s.criar({ empresa: "Imob X", plano: "Ouro", diretorNome: "Ana", diretorEmail: "a@x.com" })).rejects.toThrow(/Plano inválido/);
    await expect(s.criar({ empresa: "Imob X", plano: "Corretor", diretorNome: "Ana", diretorEmail: "a@x.com" })).rejects.toThrow(/já é de outro cliente/);
  });

  it("plano personalizado (CEO) usa a quantidade digitada e exige o número", async () => {
    ENV.forEach((k) => (process.env[k] = "x"));
    const s: any = new ClientesSaasService(repo() as any);
    s.provisionar = async () => null;
    await expect(s.criar({ empresa: "Rede X", plano: PLANO_PERSONALIZADO, diretorNome: "Ana", diretorEmail: "a@x.com" })).rejects.toThrow(/quantidade de usuários/);
    const c = await s.criar({ empresa: "Rede X", plano: PLANO_PERSONALIZADO, limiteUsuarios: 450, diretorNome: "Ana", diretorEmail: "a@x.com" });
    expect(c.limiteUsuarios).toBe(450);
  });
});
