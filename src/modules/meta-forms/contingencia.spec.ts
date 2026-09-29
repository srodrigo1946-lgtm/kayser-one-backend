import { MetaFormsService, variacoesTelefone } from "./meta-forms.service";

describe("Contingência do WhatsApp / puxar formulários", () => {
  it("variações do telefone acham lead com ou sem 55", () => {
    expect(variacoesTelefone("5521974654496").sort()).toEqual(["21974654496", "5521974654496"].sort());
    expect(variacoesTelefone("21974654496")).toContain("5521974654496");
    expect(variacoesTelefone("")).toEqual([]);
  });

  it("WhatsApp pausado: não manda a 1ª mensagem pendente", async () => {
    const whatsapp: any = { pausado: async () => true, conectado: async () => true };
    const s: any = new MetaFormsService({} as any, {} as any, {} as any, { get: () => "" } as any, { get: async () => ({}) } as any, whatsapp);
    expect(await s.contatarPendentes()).toEqual({ enviados: 0, motivo: "pausado" });
  });

  it("sem token do Meta, puxar avisa em vez de quebrar", async () => {
    const s: any = new MetaFormsService({} as any, {} as any, {} as any, { get: () => "" } as any, { get: async () => ({}) } as any, {} as any);
    const r = await s.sincronizar(72);
    expect(r.novos).toBe(0);
    expect(r.erro).toContain("Token");
  });
});

import { erroMeta } from "./meta-forms.service";
describe("erroMeta", () => {
  it("token vencido vira mensagem clara", () => {
    expect(erroMeta({ response: { data: { error: { code: 190, message: "Session has expired" } } } })).toContain("venceu");
    expect(erroMeta({ message: "ETIMEDOUT" })).toContain("ETIMEDOUT");
  });
});
