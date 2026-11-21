import { BolsaoService, podePegarBolsao } from "./bolsao.service";
import { prazoBolsao } from "../../common/prazo-bolsao";

const hist = { log: async () => null } as any;

describe("Bolsão", () => {
  it("prazo por etapa: 48h, 7d, 15d, 30d; outras etapas sem relógio", () => {
    const base = new Date("2026-11-20T12:00:00Z");
    const h = (st: string) => (prazoBolsao(st, base)!.getTime() - base.getTime()) / 3_600_000;
    expect(h("primeiro_contato")).toBe(48);
    expect(h("agendamento")).toBe(168);
    expect(h("visita_realizada")).toBe(360);
    expect(h("subida_pasta")).toBe(720);
    expect(h("em_atendimento")).toBe(72);
    expect(prazoBolsao("simulacao", base)).toBeNull();
  });

  it("só corretor da casa pega; gestor, empresa parceira e inativo não", () => {
    expect(podePegarBolsao({ role: "corretor", active: true } as any)).toBe(true);
    expect(podePegarBolsao({ role: "gerente", active: true } as any)).toBe(false);
    expect(podePegarBolsao({ role: "diretor", active: true } as any)).toBe(false);
    expect(podePegarBolsao({ role: "corretor", active: true, empresaId: "x" } as any)).toBe(false);
    expect(podePegarBolsao({ role: "corretor", active: false } as any)).toBe(false);
  });

  it("corretor não vê nome/telefone antes de pegar; Diretor vê", async () => {
    const leads = { find: async () => [{ id: "1", name: "Ana", phone: "21999", empreendimento: "Stillo", bolsaoEm: new Date() }] } as any;
    const s = new BolsaoService(leads, {} as any, hist);
    const c = await s.lista({ role: "corretor", active: true } as any);
    expect(c.leads[0]).not.toHaveProperty("name");
    const d = await s.lista({ role: "diretor", active: true } as any);
    expect(d.leads[0]).toHaveProperty("name", "Ana");
  });

  it("2º a clicar não leva o lead", async () => {
    const qb: any = { update: () => qb, set: () => qb, where: () => qb, andWhere: () => qb, execute: async () => ({ affected: 0 }) };
    const leads = { findOne: async () => ({ id: "1", status: "novo_lead" }), createQueryBuilder: () => qb } as any;
    const s = new BolsaoService(leads, { update: async () => null } as any, hist);
    await expect(s.pegar("1", { name: "Bia", role: "corretor", active: true } as any)).rejects.toThrow("já foi pego");
  });

  it("move os SWAT parados e tira da fila", async () => {
    const qs: string[] = [];
    const leads = { query: async (q: string) => (qs.push(q), q.startsWith("UPDATE leads") ? [[{ id: "a" }, { id: "b" }], 2] : []) } as any;
    const s = new BolsaoService(leads, {} as any, hist);
    expect(await s.moverParados()).toBe(2);
    expect(qs.some((q) => q.includes("lead_queue_assignments"))).toBe(true);
  });
});
