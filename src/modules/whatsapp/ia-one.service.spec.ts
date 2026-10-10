import { IaOneService } from "./ia-one.service";

describe("IA One — reset de senha pelo WhatsApp", () => {
  const montar = () => {
    const updates: any[] = [];
    const users = { update: async (id: string, d: any) => updates.push({ id, ...d }) };
    const s = new IaOneService({} as any, users as any, {} as any, {} as any, {} as any, {} as any);
    return { s: s as any, updates };
  };
  const corretor = { id: "u1", name: "Ana", email: "ana@x.com", role: "corretor", active: true, approved: true } as any;

  it("reseta pra uma senha provisória ALEATÓRIA quando o e-mail confere (sem diferenciar maiúscula)", async () => {
    const bcrypt = require("bcryptjs");
    const { s, updates } = montar();
    const r = await s.resetarSenha(corretor, " ANA@x.com ");
    expect(r.ok).toBe(true);
    expect(r.senhaProvisoria).toMatch(/^[a-z2-9]{8}$/);
    expect(updates[0]).toEqual(expect.objectContaining({ id: "u1", firstLogin: true }));
    expect(await bcrypt.compare(r.senhaProvisoria, updates[0].passwordHash)).toBe(true); // salvo com hash
    expect(await bcrypt.compare("123456789", updates[0].passwordHash)).toBe(false);
  });

  it("identifica pelo DDD + número (outro DDD com o mesmo final NÃO é a mesma pessoa)", () => {
    const { chaveTelefone } = require("./ia-one.service");
    expect(chaveTelefone("5521999998888")).toBe(chaveTelefone("(21) 99999-8888"));
    expect(chaveTelefone("552199998888")).toBe(chaveTelefone("21 99999-8888")); // sem o 9º dígito
    expect(chaveTelefone("5511999998888")).not.toBe(chaveTelefone("5521999998888"));
    expect(chaveTelefone("99998888")).toBe(""); // sem DDD não identifica
  });

  it("não reseta com e-mail diferente, Diretor, número de fora ou 2x na mesma hora", async () => {
    const { s, updates } = montar();
    expect((await s.resetarSenha(corretor, "outro@x.com")).erro).toContain("NÃO confere");
    expect((await s.resetarSenha({ ...corretor, role: "diretor" }, "ana@x.com")).erro).toContain("Diretor");
    expect((await s.resetarSenha(null, "ana@x.com")).erro).toBeTruthy();
    await s.resetarSenha(corretor, "ana@x.com");
    expect((await s.resetarSenha(corretor, "ana@x.com")).erro).toContain("menos de 1 hora");
    expect(updates).toHaveLength(1);
  });
});

describe("IA One — vínculo do WhatsApp pelo e-mail (com código)", () => {
  const fetchOriginal = global.fetch;
  let emails: any[];
  beforeEach(() => {
    emails = [];
    process.env.RESEND_API_KEY = "teste";
    global.fetch = (async (_url: string, init: any) => {
      emails.push(JSON.parse(init.body));
      return { ok: true } as any;
    }) as any;
  });
  afterEach(() => {
    global.fetch = fetchOriginal;
    delete process.env.RESEND_API_KEY;
  });
  const montar = (lista: any[]) => {
    const updates: any[] = [];
    const users = {
      find: async () => lista,
      findOne: async ({ where }: any) => lista.find((u) => u.id === where.id) ?? null,
      update: async (id: string, d: any) => updates.push({ id, ...d }),
    };
    return { s: new IaOneService({} as any, users as any, {} as any, {} as any, {} as any, {} as any) as any, updates };
  };
  const NEUTRA = "Se esse e-mail for de um usuário";

  it("só vincula depois que a pessoa devolve o código que foi pro e-mail", async () => {
    const { s, updates } = montar([{ id: "u1", name: "Ana Souza", email: "ana@x.com", active: true }]);
    expect(await s.vincularPorEmail("5521999998888", "oi")).toContain("e-mail");
    expect(await s.vincularPorEmail("5521999998888", "é ANA@x.com")).toContain(NEUTRA);
    expect(updates).toHaveLength(0); // ainda NÃO vinculou
    expect(emails[0].to).toBe("ana@x.com");
    const codigo = s.vinculosPendentes.get("5521999998888").codigo;
    expect(emails[0].text).toContain(codigo);
    const errado = codigo === "111111" ? "222222" : "111111";
    expect(await s.vincularPorEmail("5521999998888", errado)).toContain("não confere");
    expect(await s.vincularPorEmail("5521999998888", codigo)).toContain("Pronto, Ana");
    expect(updates[0]).toEqual(expect.objectContaining({ id: "u1", whatsapp: "5521999998888" }));
  });

  it("resposta igual (neutra) pra e-mail desconhecido, desativado ou com outro telefone — sem mandar código", async () => {
    const { s, updates } = montar([
      { id: "u1", name: "Ana", email: "ana@x.com", active: true, phone: "21 98888-7777" },
      { id: "u2", name: "Angela Carvalho", email: "angela@x.com", active: false },
    ]);
    for (const e of ["ana@x.com", "nao@x.com", "angela@x.com"]) {
      const r = await s.vincularPorEmail("5521999998888", e);
      expect(r).toContain(NEUTRA);
      expect(r).not.toMatch(/Angela|desativad|outro telefone/);
    }
    expect(emails).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it("código errado 5 vezes cancela o vínculo", async () => {
    const { s, updates } = montar([{ id: "u1", name: "Ana", email: "ana@x.com", active: true }]);
    await s.vincularPorEmail("5521999998888", "ana@x.com");
    const codigo = s.vinculosPendentes.get("5521999998888").codigo;
    const errado = codigo === "111111" ? "222222" : "111111";
    for (let i = 0; i < 5; i++) await s.vincularPorEmail("5521999998888", errado);
    expect(await s.vincularPorEmail("5521999998888", codigo)).not.toContain("Pronto");
    expect(updates).toHaveLength(0);
  });

  it("reset de senha bloqueado nas primeiras 24 h do vínculo", async () => {
    const { s } = montar([]);
    const u = { id: "u1", name: "Ana", email: "ana@x.com", role: "corretor", active: true, approved: true, whatsappVinculadoEm: new Date() };
    expect((await s.resetarSenha(u, "ana@x.com")).erro).toContain("24 h");
  });
});

describe("IA One — importar unidades em Excel", () => {
  const XLSX = require("xlsx");
  it("lista do simulador sem nome dentro usa o nome do arquivo e junta com o que já tinha", async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["DADOS DAS UNIDADES"],
      ["STATUS DA UNIDADE", "IDENTIFICADOR", "VALOR DE VENDA", "AVALIAÇÃO", "MÓDULO", "ENTREGA PJ", "ENTREGA OBRA"],
      ["Disponível", "BL02-0205", 475548, 514000, 1, 33, 33],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Planilha1");
    const base64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
    const salvos: any[] = [];
    const settings = {
      get: async () => ({ ioneUnidadesCsv: salvos.length ? salvos[salvos.length - 1].ioneUnidadesCsv : 'PRODUTO,BLOCO,UNIDADE,STATUS,DATA DE ENTREGA,VAGA,TIPO,ÁREA,PREÇO,AVALIAÇÃO\n"Vibe Sunset","1","BL01-0101","Disponível","01/2027","","","0","500000","500000"' }),
      update: async (d: any) => salvos.push(d),
    };
    const s: any = new IaOneService({} as any, {} as any, settings as any, {} as any, {} as any, {} as any);
    s.dados = async () => ({ simulador: { empreendimentos: [{ nome: "Ilhamar Beach & Home" }] }, unidades: [], promocoes: [] });
    s.resumoDados = async () => ({});
    const r = await s.importarUnidades("ilhamar.xlsx", base64);
    expect(r).toEqual(expect.objectContaining({ importadas: 1, empreendimento: "Ilhamar Beach & Home" }));
    expect(salvos[0].ioneUnidadesCsv).toContain("Vibe Sunset"); // o que já tinha continua
    expect(salvos[0].ioneUnidadesCsv).toContain('"Ilhamar Beach & Home","2","BL02-0205","Disponível"');
    expect(salvos[0].ioneUnidadesCsv).toContain('"475548"');
    expect(salvos[0].ioneUnidadesCsv).toMatch(/"Ilhamar Beach & Home".*"\d{4}-\d{2}-\d{2}"/); // data do envio
  });
});
