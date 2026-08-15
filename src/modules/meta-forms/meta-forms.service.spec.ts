import { MetaFormsService } from "./meta-forms.service";

function svc() {
  const conversations: any = {};
  const leadQueue: any = {};
  const leadsRepo: any = {};
  const config: any = { get: (k: string) => (k === "META_VERIFY_TOKEN" ? "segredo" : "") };
  return new MetaFormsService(conversations, leadQueue, leadsRepo, config);
}

describe("MetaFormsService", () => {
  it("verify devolve o challenge só com o token certo", () => {
    expect(svc().verify("subscribe", "segredo", "123")).toBe("123");
    expect(svc().verify("subscribe", "errado", "123")).toBeNull();
    expect(svc().verify("outro", "segredo", "123")).toBeNull();
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
});
