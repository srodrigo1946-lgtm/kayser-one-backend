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
