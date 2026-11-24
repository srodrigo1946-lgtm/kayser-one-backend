import { BolsaoService, podePegarBolsao, bloqueadoNoBolsao } from "./bolsao.service";
import { prazoBolsao, ehLeadDeAnuncio } from "../../common/prazo-bolsao";

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
    expect(h("documentacao")).toBe(18 * 24);
    expect(h("aprovacao")).toBe(30 * 24);
    expect(h("reprovacao")).toBe(30 * 24);
    expect(prazoBolsao("simulacao", base)).toBeNull();
  });

  it("bloqueio do Diretor: corretor sozinho ou o time inteiro do gerente", () => {
    const chefe = new Map<string, string | null>([["c1", "g1"], ["c2", "g2"], ["g1", "d"], ["g2", "d"]]);
    expect(bloqueadoNoBolsao("c1", new Set(["g1"]), chefe)).toBe(true); // gerente bloqueado → time
    expect(bloqueadoNoBolsao("c2", new Set(["g1"]), chefe)).toBe(false);
    expect(bloqueadoNoBolsao("c2", new Set(["c2"]), chefe)).toBe(true);
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
    const leads = {
      query: async (q: string) => {
        qs.push(q);
        if (q.startsWith("UPDATE leads SET")) return [[{ id: "a" }, { id: "b" }], 2]; // SWAT
        if (q.startsWith("UPDATE leads l")) return [[{ id: "c" }], 1]; // fila normal (23/11)
        return [];
      },
    } as any;
    const s = new BolsaoService(leads, {} as any, hist);
    expect(await s.moverParados()).toBe(3);
    expect(qs.some((q) => q.includes("UPDATE lead_queue_assignments"))).toBe(true);
    // Fila normal / anúncio: fora da SWAT e fora do Bolsão (pode voltar depois de pego).
    const normal = qs.find((q) => q.startsWith("UPDATE leads l")) || "";
    expect(normal).toContain("x.bolsao = false");
    expect(normal).toContain("swat = false");
    // Todos os leads de anúncio (23/11), contando a partir do início do SLA.
    expect(normal).toContain("google_ads");
    expect(normal).toContain("$3::timestamptz");
  });

  it("lead de anúncio = Meta (form/anúncio/WhatsApp), Google Ads ou Vitrine", () => {
    expect(ehLeadDeAnuncio({ source: "formulario_meta" })).toBe(true);
    expect(ehLeadDeAnuncio({ source: "manual", origem: "google_ads" })).toBe(true);
    expect(ehLeadDeAnuncio({ source: "manual", campanha: "Vitrine Stillo" })).toBe(true);
    expect(ehLeadDeAnuncio({ source: "planilha", origem: "Time Isaac" })).toBe(false);
  });
});
