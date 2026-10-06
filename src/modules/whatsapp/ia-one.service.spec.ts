import { IaOneService } from "./ia-one.service";

describe("IA One — reset de senha pelo WhatsApp", () => {
  const montar = () => {
    const updates: any[] = [];
    const users = { update: async (id: string, d: any) => updates.push({ id, ...d }) };
    const s = new IaOneService({} as any, users as any, {} as any, {} as any, {} as any);
    return { s: s as any, updates };
  };
  const corretor = { id: "u1", name: "Ana", email: "ana@x.com", role: "corretor", active: true, approved: true } as any;

  it("reseta pra 123456789 quando o e-mail confere (sem diferenciar maiúscula)", async () => {
    const { s, updates } = montar();
    const r = await s.resetarSenha(corretor, " ANA@x.com ");
    expect(r.ok).toBe(true);
    expect(updates[0]).toEqual(expect.objectContaining({ id: "u1", firstLogin: true }));
    expect(updates[0].passwordHash).not.toBe("123456789"); // salvo com hash
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

describe("IA One — vínculo do WhatsApp pelo e-mail", () => {
  const montar = (lista: any[]) => {
    const updates: any[] = [];
    const users = { find: async () => lista, update: async (id: string, d: any) => updates.push({ id, ...d }) };
    return { s: new IaOneService({} as any, users as any, {} as any, {} as any, {} as any) as any, updates };
  };

  it("pede o e-mail e vincula quando o cadastro não tem telefone", async () => {
    const { s, updates } = montar([{ id: "u1", name: "Ana Souza", email: "ana@x.com", active: true }]);
    expect(await s.vincularPorEmail("5521999998888", "oi")).toContain("e-mail");
    expect(await s.vincularPorEmail("5521999998888", "é ANA@x.com")).toContain("Pronto, Ana");
    expect(updates[0]).toEqual(expect.objectContaining({ id: "u1", whatsapp: "5521999998888" }));
  });

  it("não troca telefone já cadastrado nem vincula e-mail desconhecido", async () => {
    const { s, updates } = montar([{ id: "u1", name: "Ana", email: "ana@x.com", active: true, phone: "21 98888-7777" }]);
    expect(await s.vincularPorEmail("5521999998888", "ana@x.com")).toContain("já tem outro telefone");
    expect(await s.vincularPorEmail("5521999998888", "nao@x.com")).toContain("Não achei");
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
    const s: any = new IaOneService({} as any, {} as any, settings as any, {} as any, {} as any);
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
