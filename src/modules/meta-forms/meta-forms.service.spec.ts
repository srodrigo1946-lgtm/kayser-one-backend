import { MetaFormsService, mensagemFormulario, telefoneWhatsapp } from "./meta-forms.service";

function svc() {
  const conversations: any = {};
  const leadQueue: any = {};
  const leadsRepo: any = {};
  const config: any = { get: () => "" };
  // Token vem das Configurações (banco), como em produção.
  const settings: any = { get: async () => ({ metaVerifyToken: "segredo", metaPageToken: "" }) };
  return new MetaFormsService(conversations, leadQueue, leadsRepo, config, settings, {} as any);
}

describe("MetaFormsService", () => {
  it("verify devolve o challenge só com o token certo", async () => {
    expect(await svc().verify("subscribe", "segredo", "123")).toBe("123");
    expect(await svc().verify("subscribe", "errado", "123")).toBeNull();
    expect(await svc().verify("outro", "segredo", "123")).toBeNull();
  });

  it("mapFieldData extrai nome, telefone (só dígitos) e email", () => {
    const fd = [
      { name: "full_name", values: ["Lorena Altino"] },
      { name: "phone_number", values: ["+55 21 96950-9865"] },
      { name: "email", values: ["a@b.com"] },
    ];
    const r = (svc() as any).mapFieldData(fd);
    expect(r).toEqual({ name: "Lorena Altino", phone: "5521969509865", email: "a@b.com" });
  });

  it("mapFieldData usa fallback quando falta nome", () => {
    const r = (svc() as any).mapFieldData([{ name: "phone_number", values: ["21999"] }]);
    expect(r.name).toBe("Contato do formulário");
    expect(r.phone).toBe("21999");
  });

  it("só aceita lead dos formulários marcados (ex.: só o 'Ilha stay lead')", async () => {
    const settings: any = { get: async () => ({ metaFormIds: "960631980396672" }) };
    const s: any = new MetaFormsService({} as any, {} as any, {} as any, { get: () => "" } as any, settings, {} as any);
    const buscados: string[] = [];
    s.fetchLead = async (id: string) => {
      buscados.push(id);
      return null; // sem telefone → não cria nada (não toca no banco)
    };
    const evento = (leadgen_id: string, form_id: string) => ({ field: "leadgen", value: { leadgen_id, form_id } });
    await s.handleLeadgen({
      entry: [{ changes: [evento("L1", "960631980396672"), evento("L2", "26634231496201321")] }],
    });
    expect(buscados).toEqual(["L1"]); // o da Barra Olímpica foi ignorado
  });

  it("1ª mensagem do formulário: Kayser fora do plantão, corretor no plantão", () => {
    const k = mensagemFormulario({ nome: "Zilda", empreendimento: "Ilha stay home Resort", kayser: true });
    expect(k).toContain("Olá, Zilda!");
    expect(k).toContain("Eu sou o *Kayser*");
    expect(k).toContain("*Ilha stay home Resort*");
    const c = mensagemFormulario({ nome: "Zilda", empreendimento: "Ilha stay home Resort", corretor: "Marcelo Dias", kayser: false });
    expect(c).toContain("especialista *Marcelo Dias*");
    expect(c).not.toContain("Kayser");
    expect(mensagemFormulario({ nome: "", kayser: false })).toContain("Olá! 👋 Recebemos seu cadastro sobre o imóvel");
  });

  it("telefone do formulário ganha o 55 do Brasil", () => {
    expect(telefoneWhatsapp("(21) 99999-1234")).toBe("5521999991234");
    expect(telefoneWhatsapp("+55 22 99931-9467")).toBe("5522999319467");
  });

  it("recebeDireto rejeita token errado e aceita o certo", async () => {
    const s: any = svc();
    const criados: any[] = [];
    s.criarLead = async (d: any) => criados.push(d); // não toca no banco no teste

    expect(await s.recebeDireto("errado", { nome: "X", telefone: "21988887777" })).toEqual({ ok: false });
    expect(criados).toHaveLength(0);

    const r = await s.recebeDireto("segredo", { nome: "Lorena", telefone: "+55 21 96950-9865", email: "a@b.com" });
    expect(r).toEqual({ ok: true });
    expect(criados[0]).toEqual({ name: "Lorena", phone: "5521969509865", email: "a@b.com" });
  });
});
