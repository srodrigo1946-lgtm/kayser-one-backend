import * as XLSX from "xlsx";
import { LeadsService, campoDoCabecalho } from "./leads.service";
import { UserRole } from "../users/user.entity";

function planilha(linhas: any[][]) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), "Leads");
  return { buffer: XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) } as any;
}

describe("Importar planilha de leads", () => {
  it("entende os cabeçalhos mais comuns", () => {
    expect(campoDoCabecalho("Nome Completo")).toBe("name");
    expect(campoDoCabecalho("CELULAR")).toBe("phone");
    expect(campoDoCabecalho("Telefone 1")).toBe("phone");
    expect(campoDoCabecalho("WhatsApp")).toBe("whatsapp");
    expect(campoDoCabecalho("E-mail")).toBe("email");
    expect(campoDoCabecalho("Observações")).toBe("observacoes");
  });

  it("importa com cabeçalho diferente, telefone numérico e ignora repetidos", async () => {
    const salvos: any[] = [];
    const leadsRepo: any = {
      create: (x: any) => x,
      save: async (x: any) => { salvos.push(...x); return x; },
      findOne: async () => null,
    };
    const s = new LeadsService(leadsRepo, {} as any, {} as any, {} as any, {} as any, { get: () => undefined } as any);
    const file = planilha([
      ["Relatório de leads"],
      ["Nome Completo", "Celular", "E-mail"],
      ["Ana", 21988887777, "a@b.com"],
      ["Bia", "(21) 97777-6666", ""],
      ["Ana de novo", "5521988887777", ""],
      ["Sem tel", "", ""],
    ]);
    const r = await s.importFromExcel(file, { id: "d", role: UserRole.DIRETOR } as any);
    expect(r.imported).toBe(2);
    expect(r.duplicates).toBe(1);
    expect(r.semTelefone).toBe(1);
    expect(salvos[0]).toMatchObject({ name: "Ana", phone: "21988887777", email: "a@b.com" });
  });

  it("reparte a mesma planilha em lotes (responsável/coluna/time) e o resto no padrão", async () => {
    const salvos: any[] = [];
    const leadsRepo: any = {
      create: (x: any) => x,
      save: async (x: any) => { salvos.push(...x); return x; },
      findOne: async () => null,
      manager: { query: async (_q: string, [k]: any) => (k ? [{ key: k, somenteGestores: false }] : []) },
    };
    const users: any = { getScopeIds: async () => null };
    const s = new LeadsService(leadsRepo, {} as any, {} as any, {} as any, users, { get: () => undefined } as any);
    const linhas: any[][] = [["Nome", "Telefone"]];
    for (let i = 0; i < 7; i++) linhas.push([`L${i}`, `2199990000${i}`]);
    const r: any = await s.importFromExcel(
      planilha(linhas),
      { id: "d", role: UserRole.DIRETOR } as any,
      undefined,
      "novo_lead",
      JSON.stringify([
        { quantidade: 2, responsavelId: "isaac", origem: "isaac" },
        { quantidade: 3, status: "primeiro_contato" },
      ])
    );
    expect(r.imported).toBe(7);
    expect(r.porLote).toEqual([2, 3]);
    expect(r.restante).toBe(2);
    expect(salvos[0]).toMatchObject({ responsavelId: "isaac", origem: "Time Isaac", source: "time", status: "novo_lead" });
    expect(salvos[2]).toMatchObject({ status: "primeiro_contato" });
    expect(salvos[6]).toMatchObject({ status: "novo_lead" });
  });

  it("sem coluna de telefone avisa quais colunas achou", async () => {
    const s = new LeadsService({} as any, {} as any, {} as any, {} as any, {} as any, { get: () => undefined } as any);
    await expect(
      s.importFromExcel(planilha([["Cliente", "Bairro"], ["Ana", "Centro"]]), { id: "d", role: UserRole.DIRETOR } as any)
    ).rejects.toThrow(/Colunas encontradas: Cliente, Bairro/);
  });
});

describe("Coluna Cidade da planilha", () => {
  it("é ignorada (vinha 'Força de vendas'/'Automação')", () => {
    expect(campoDoCabecalho("Cidade")).toBeNull();
  });
});
