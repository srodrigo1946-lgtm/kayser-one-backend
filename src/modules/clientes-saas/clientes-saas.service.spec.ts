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

describe("Clientes SaaS — adicionais", () => {
  const ENV = ["RAILWAY_API_TOKEN", "RAILWAY_CLIENTES_PROJECT_ID", "RAILWAY_CLIENTES_ENV_ID", "ANTHROPIC_API_KEY"];
  afterEach(() => ENV.forEach((k) => delete process.env[k]));

  it("grava só adicionais conhecidos, sem repetir, e manda pro servidor do cliente", async () => {
    ENV.forEach((k) => (process.env[k] = "x"));
    process.env.ANTHROPIC_API_KEY = "chave-kayser";
    const updates: any[] = [];
    const repo = { findOne: async () => ({ id: "c1", railwayServiceId: "srv1" }), update: async (_: string, d: any) => updates.push(d) };
    const s: any = new ClientesSaasService(repo as any);
    const chamadas: any[] = [];
    s.gql = async (_q: string, v: any) => chamadas.push(v.input);
    const r = await s.mudarAdicionais("c1", ["meta", "ia", "meta", "hack"]);
    expect(r.adicionais).toBe("meta,ia");
    expect(updates[0]).toEqual({ adicionais: "meta,ia" });
    const de = (nome: string) => chamadas.filter((c) => c.name === nome);
    expect(de("ADICIONAIS")[0]).toEqual(expect.objectContaining({ serviceId: "srv1", value: "meta,ia" }));
    // IA ligada: o servidor do cliente recebe a chave da Kayser.
    expect(de("ANTHROPIC_API_KEY")[0].value).toBe("chave-kayser");
    expect((await s.mudarAdicionais("c1", [])).adicionais).toBe("");
    expect(de("ADICIONAIS")[1].value).toBe("nenhum");
    // IA desligada: a chave sai (variableDelete, sem value).
    expect(de("ANTHROPIC_API_KEY")[1].value).toBeUndefined();
  });
});

describe("Clientes SaaS — cobrança (Mercado Pago)", () => {
  const { valorDoCliente } = require("./clientes-saas.service");
  const fetchOriginal = global.fetch;
  afterEach(() => {
    global.fetch = fetchOriginal;
    delete process.env.MP_ACCESS_TOKEN;
  });

  it("valor = negociado, senão plano + adicionais de tabela; personalizado sem valor não tem preço", () => {
    expect(valorDoCliente({ plano: "Corretor", adicionais: "ia", valorMensal: null })).toBe(78);
    expect(valorDoCliente({ plano: "Gerente de Vendas", adicionais: "ia,ione,meta", valorMensal: null })).toBe(110 + 149 + 59 + 29);
    expect(valorDoCliente({ plano: "Corretor", adicionais: "ia", valorMensal: 60 })).toBe(60);
    expect(valorDoCliente({ plano: "Personalizado (CEO)", adicionais: "", valorMensal: null })).toBeNull();
  });

  it("cobrar cria a assinatura mensal com o valor do cliente e guarda o link", async () => {
    process.env.MP_ACCESS_TOKEN = "teste";
    const enviado: any[] = [];
    global.fetch = (async (url: string, init: any) => {
      enviado.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      return { ok: true, json: async () => ({ id: "pre1", init_point: "https://mp/link", status: "pending" }) } as any;
    }) as any;
    const updates: any[] = [];
    const cliente = { id: "c1", empresa: "Imob X", plano: "Corretor", adicionais: "ia", valorMensal: null, diretorNome: "Ana", diretorEmail: "a@x.com" };
    const repo = { findOne: async () => cliente, update: async (_: string, d: any) => updates.push(d) };
    const s = new ClientesSaasService(repo as any);
    const r = await s.cobrar("c1");
    expect(r).toEqual({ link: "https://mp/link", valor: 78 });
    expect(enviado[0].url).toBe("https://api.mercadopago.com/preapproval");
    expect(enviado[0].body).toEqual(expect.objectContaining({ external_reference: "c1", payer_email: "a@x.com" }));
    expect(enviado[0].body.auto_recurring).toEqual(expect.objectContaining({ transaction_amount: 78, frequency_type: "months" }));
    expect(updates[0]).toEqual({ cobrancaId: "pre1", cobrancaLink: "https://mp/link", assinatura: "pending" });
  });

  it("aviso do Mercado Pago confere a assinatura no MP antes de atualizar o cliente", async () => {
    process.env.MP_ACCESS_TOKEN = "teste";
    const id = "11111111-2222-3333-4444-555555555555";
    global.fetch = (async (url: string) =>
      url.includes("api.mercadopago.com")
        ? ({ ok: true, json: async () => ({ id: "pre1", status: "authorized", external_reference: id }) } as any)
        : ({ ok: true, json: async () => ({}) } as any)) as any;
    const updates: any[] = [];
    const repo = { findOne: async () => ({ id, empresa: "Imob X", plano: "Corretor", assinatura: "pending" }), update: async (_: string, d: any) => updates.push(d) };
    const s = new ClientesSaasService(repo as any);
    await s.avisoMercadoPago({ type: "subscription_preapproval", data: { id: "pre1" } }, {});
    expect(updates[0]).toEqual({ assinatura: "authorized", cobrancaId: "pre1" });
    // aviso que não é de assinatura: ignora
    await s.avisoMercadoPago({ type: "payment", data: { id: "x" } }, {});
    expect(updates).toHaveLength(1);
  });
});

describe("Clientes SaaS — cliente assina sozinho pelo site", () => {
  const ENV = ["RAILWAY_API_TOKEN", "RAILWAY_CLIENTES_PROJECT_ID", "RAILWAY_CLIENTES_ENV_ID", "MP_ACCESS_TOKEN"];
  const fetchOriginal = global.fetch;
  afterEach(() => {
    ENV.forEach((k) => delete process.env[k]);
    global.fetch = fetchOriginal;
  });
  const mpResponde = (assinatura: any) =>
    (global.fetch = (async (url: string) =>
      ({ ok: true, json: async () => (url.includes("api.mercadopago.com") ? assinatura : {}) }) as any) as any);

  it("descobre o plano pelo valor da assinatura", () => {
    const { planoPeloValor } = require("./clientes-saas.service");
    expect(planoPeloValor(49)).toBe("Corretor");
    expect(planoPeloValor("330")).toBe("Gerente Geral");
    expect(planoPeloValor(12)).toBeNull();
  });

  it("pagou e não se cadastrou: entra no painel como 'aguardando', com o e-mail do pagador", async () => {
    process.env.MP_ACCESS_TOKEN = "t";
    mpResponde({ id: "PRE9", status: "authorized", payer_email: "joao@x.com", auto_recurring: { transaction_amount: 110 } });
    const salvos: any[] = [];
    const repo = { findOne: async () => null, create: (x: any) => x, save: async (x: any) => salvos.push(x), update: async () => null };
    await new ClientesSaasService(repo as any).avisoMercadoPago({ type: "subscription_preapproval", data: { id: "PRE9" } }, {});
    expect(salvos[0]).toEqual(expect.objectContaining({ status: "aguardando", plano: "Gerente de Vendas", diretorEmail: "joao@x.com", origem: "site", cobrancaId: "PRE9" }));
    expect(salvos[0].subdominio).toMatch(/^pendente-/);
  });

  it("comecar: só com assinatura paga; completa o 'aguardando' e manda criar", async () => {
    ENV.forEach((k) => (process.env[k] = "x"));
    const updates: any[] = [];
    const aguardando = { id: "c9", status: "aguardando", cobrancaId: "PRE9" };
    const repo = {
      findOne: async ({ where }: any) => (where.cobrancaId ? aguardando : null),
      create: (x: any) => x,
      save: async (x: any) => x,
      update: async (_: string, d: any) => updates.push(d),
    };
    const s: any = new ClientesSaasService(repo as any);
    s.provisionar = async () => null;

    mpResponde({ id: "PRE9", status: "pending", auto_recurring: { transaction_amount: 49 } });
    await expect(s.comecar({ assinatura: "PRE9", empresa: "Imob Nova", diretorNome: "João", diretorEmail: "J@X.com" })).rejects.toThrow(/confirmando o pagamento/);

    mpResponde({ id: "PRE9", status: "authorized", auto_recurring: { transaction_amount: 49 } });
    const r = await s.comecar({ assinatura: "PRE9", empresa: "Imob Nova", diretorNome: "João", diretorEmail: "J@X.com" });
    expect(r.endereco).toBe("https://imobnova.kayserone.com.br");
    expect(updates[0]).toEqual(expect.objectContaining({ empresa: "Imob Nova", plano: "Corretor", status: "criando", diretorEmail: "j@x.com", origem: "site" }));
  });

  it("comecar: assinatura que já virou Kayser One não cria de novo", async () => {
    ENV.forEach((k) => (process.env[k] = "x"));
    mpResponde({ id: "PRE9", status: "authorized", auto_recurring: { transaction_amount: 49 } });
    const repo = { findOne: async () => ({ id: "c9", status: "ativo", cobrancaId: "PRE9" }) };
    await expect(new ClientesSaasService(repo as any).comecar({ assinatura: "PRE9", empresa: "X Y", diretorNome: "Jo", diretorEmail: "j@x.com" })).rejects.toThrow(/já tem um Kayser One/);
  });
});
