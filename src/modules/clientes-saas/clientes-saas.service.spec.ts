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

  it("cobrar cria um PLANO mensal só do cliente (link que qualquer pessoa paga) e guarda o link", async () => {
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
    expect(r).toEqual({ link: "https://mp/link", valor: 74.1 }); // 78 com 5% de desconto do cartão
    expect(enviado[0].url).toBe("https://api.mercadopago.com/preapproval_plan");
    expect(enviado[0].body.payer_email).toBeUndefined(); // não prende o link ao e-mail do Diretor
    expect(enviado[0].body.auto_recurring).toEqual(expect.objectContaining({ transaction_amount: 74.1, frequency_type: "months" }));
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

describe("Clientes SaaS — aviso do Mercado Pago de assinatura que não existe", () => {
  const fetchOriginal = global.fetch;
  afterEach(() => {
    global.fetch = fetchOriginal;
    delete process.env.MP_ACCESS_TOKEN;
  });
  it("responde ok sem mexer em nada (ex.: Simular notificação com id 123456)", async () => {
    process.env.MP_ACCESS_TOKEN = "t";
    global.fetch = (async () => ({ ok: false, status: 404, json: async () => ({ message: "not found" }) })) as any;
    const updates: any[] = [];
    const repo = { findOne: async () => null, update: async () => updates.push(1), save: async () => updates.push(1), create: (x: any) => x };
    const r = await new ClientesSaasService(repo as any).avisoMercadoPago({ type: "subscription_preapproval", data: { id: "123456" } }, {});
    expect(r).toEqual({ ok: true });
    expect(updates).toHaveLength(0);
  });
});

describe("Clientes SaaS — plano do cliente e Pix", () => {
  const fetchOriginal = global.fetch;
  const id = "11111111-2222-3333-4444-555555555555";
  afterEach(() => {
    global.fetch = fetchOriginal;
    delete process.env.MP_ACCESS_TOKEN;
  });

  it("assinatura feita pelo plano do cliente é reconhecida pelo número do plano", async () => {
    process.env.MP_ACCESS_TOKEN = "t";
    global.fetch = (async (url: string) =>
      ({ ok: true, json: async () => (url.includes("mercadopago") ? { id: "SUB1", status: "authorized", preapproval_plan_id: "PLANO1" } : {}) }) as any) as any;
    const updates: any[] = [];
    const repo = {
      findOne: async ({ where }: any) => (where.cobrancaId === "PLANO1" ? { id, empresa: "Imob", plano: "Corretor", assinatura: "pending" } : null),
      update: async (_: string, d: any) => updates.push(d),
    };
    await new ClientesSaasService(repo as any).avisoMercadoPago({ type: "subscription_preapproval", data: { id: "SUB1" } }, {});
    expect(updates[0]).toEqual({ assinatura: "authorized", cobrancaId: "SUB1" });
  });

  it("cobrar Pix gera link avulso do mês com o valor do cliente; pagamento aprovado marca 'pix_pago'", async () => {
    process.env.MP_ACCESS_TOKEN = "t";
    const enviado: any[] = [];
    global.fetch = (async (url: string, init: any) => {
      enviado.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      if (url.includes("/v1/payments/")) return { ok: true, json: async () => ({ status: "approved", external_reference: id, transaction_amount: 60, payment_method_id: "pix" }) } as any;
      return { ok: true, json: async () => ({ id: "PREF1", init_point: "https://mp/pix" }) } as any;
    }) as any;
    const updates: any[] = [];
    const cliente = { id, empresa: "Imob", plano: "Corretor", adicionais: "", valorMensal: 60, diretorNome: "Ana", diretorEmail: "a@x.com", assinatura: null };
    const repo = { findOne: async () => cliente, update: async (_: string, d: any) => updates.push(d) };
    const s = new ClientesSaasService(repo as any);
    expect(await s.cobrarPix(id)).toEqual({ link: "https://mp/pix", valor: 60 });
    expect(enviado[0].url).toBe("https://api.mercadopago.com/checkout/preferences");
    expect(enviado[0].body.items[0].unit_price).toBe(60);
    expect(enviado[0].body.external_reference).toBe(id);
    await s.avisoMercadoPago({ type: "payment", data: { id: "PAY1" } }, {});
    expect(updates.at(-1)).toEqual(expect.objectContaining({ assinatura: "pix_pago" }));
  });
});

describe("Business K1 — conta do cliente, desconto, caixa e painel", () => {
  const ENV = ["RAILWAY_API_TOKEN", "RAILWAY_CLIENTES_PROJECT_ID", "RAILWAY_CLIENTES_ENV_ID", "MP_ACCESS_TOKEN"];
  const fetchOriginal = global.fetch;
  afterEach(() => {
    ENV.forEach((k) => delete process.env[k]);
    global.fetch = fetchOriginal;
  });
  const base = { id: "c1", empresa: "Imob", plano: "Corretor", adicionais: "", valorMensal: null, diretorNome: "Ana", diretorEmail: "a@x.com", railwayServiceId: "srv1", assinatura: null, bloqueadoEm: null };

  it("bloquear agora liga CONTA_BLOQUEADA no servidor do cliente; com data futura só agenda", async () => {
    ENV.forEach((k) => (process.env[k] = "x"));
    const updates: any[] = [];
    const repo = { findOne: async () => base, update: async (_: string, d: any) => updates.push(d) };
    const s: any = new ClientesSaasService(repo as any);
    const vars: any[] = [];
    s.gql = async (_q: string, v: any) => vars.push(v.input);
    await s.conta("c1", "bloquear");
    expect(vars[0]).toEqual(expect.objectContaining({ serviceId: "srv1", name: "CONTA_BLOQUEADA", value: "1" }));
    expect(updates[0].bloqueadoEm).toBeInstanceOf(Date);
    const amanha = new Date(Date.now() + 86400000).toISOString();
    const r = await s.conta("c1", "encerrar", amanha);
    expect(r.agendado).toBeInstanceOf(Date);
    expect(updates[1]).toEqual(expect.objectContaining({ agendaAcao: "encerrar" }));
    expect(vars).toHaveLength(1); // agendado não mexe no servidor ainda
  });

  it("encerrar cancela a assinatura no Mercado Pago; desbloquear reativa", async () => {
    ENV.forEach((k) => (process.env[k] = "x"));
    const chamadas: any[] = [];
    global.fetch = (async (url: string, init: any) => {
      chamadas.push({ url, method: init?.method, body: init?.body });
      return { ok: true, json: async () => ({}) } as any;
    }) as any;
    const updates: any[] = [];
    const repo = { findOne: async () => ({ ...base, cobrancaId: "SUB1", assinatura: "authorized" }), update: async (_: string, d: any) => updates.push(d) };
    const s: any = new ClientesSaasService(repo as any);
    const vars: any[] = [];
    s.gql = async (_q: string, v: any) => vars.push(v.input);
    await s.conta("c1", "encerrar");
    const mp = chamadas.find((c) => c.url.includes("/preapproval/SUB1"));
    expect(mp.method).toBe("PUT");
    expect(JSON.parse(mp.body)).toEqual({ status: "cancelled" });
    expect(updates[0]).toEqual(expect.objectContaining({ assinatura: "cancelled" }));
    await s.conta("c1", "desbloquear");
    expect(vars.at(-1).value).toBe("0");
    expect(updates.at(-1)).toEqual(expect.objectContaining({ bloqueadoEm: null, encerradoEm: null }));
  });

  it("assinatura no cartão sai com 5% de desconto sobre a tabela; valor negociado fica igual", async () => {
    process.env.MP_ACCESS_TOKEN = "t";
    const corpos: any[] = [];
    global.fetch = (async (url: string, init: any) => {
      if (url.includes("mercadopago")) corpos.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ id: "P", init_point: "https://mp" }) } as any;
    }) as any;
    let cliente: any = { ...base, adicionais: "ia" }; // 49 + 29 = 78
    const repo = { findOne: async () => cliente, update: async () => null };
    const s = new ClientesSaasService(repo as any);
    expect((await s.cobrar("c1")).valor).toBe(74.1);
    cliente = { ...base, valorMensal: 60 };
    expect((await s.cobrar("c1")).valor).toBe(60);
    expect(corpos[1].auto_recurring.transaction_amount).toBe(60);
  });

  it("painel: clientes ativos, receita, caixa líquido e lucro do mês", async () => {
    const agora = new Date();
    const clientes = [
      { ...base, id: "a", status: "ativo", createdAt: new Date(agora.getFullYear(), agora.getMonth(), 1), adicionais: "", valorMensal: 100, limiteUsuarios: 1, encerradoEm: null },
      { ...base, id: "b", status: "aguardando", createdAt: agora, limiteUsuarios: 1, encerradoEm: null },
    ];
    const pagamentos = [{ liquido: 99, pagoEm: agora }];
    const repo = { find: async () => clientes };
    const pags = { find: async () => pagamentos };
    const s = new ClientesSaasService(repo as any, undefined, pags as any);
    const p = await s.painel(agora.getFullYear());
    const mes = p.meses[agora.getMonth()];
    expect(mes).toEqual(expect.objectContaining({ ativos: 1, novos: 1, receita: 100, caixa: 99, custo: 40 + 800, lucro: 99 - 840 }));
    expect(p.total.caixa).toBe(99);
  });
});
