import { variantesTelefone, telefoneBloqueado } from "./bloqueio";

describe("Lead excluído não volta", () => {
  it("guarda o telefone com e sem 55", () => {
    expect(variantesTelefone("21983529930").sort()).toEqual(["21983529930", "5521983529930"]);
    expect(variantesTelefone("+55 (21) 98352-9930").sort()).toEqual(["21983529930", "5521983529930"]);
    expect(variantesTelefone("", null, "123")).toEqual([]);
  });
  it("confere na tabela de bloqueados", async () => {
    const m: any = { query: async (_sql: string, [tels]: any) => (tels.includes("5521983529930") ? [{ "?column?": 1 }] : []) };
    expect(await telefoneBloqueado(m, "21983529930")).toBe(true);
    expect(await telefoneBloqueado(m, "21999990000")).toBe(false);
  });
});
