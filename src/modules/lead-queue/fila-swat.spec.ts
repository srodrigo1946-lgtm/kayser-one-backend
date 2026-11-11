import { LeadQueueService, SWAT_SLA_MIN } from "./lead-queue.service";

// Fila SWAT (Rodrigo 11/11): só os SWAT de plantão recebem; prazo 15 min; lead SWAT só fica na SWAT.
function make(settings: any, assignments: any[], turno: string[] | null, lead: any = { id: "L1", status: "novo_lead" }) {
  const settingsRepo: any = {
    findOne: jest.fn(async () => settings),
    save: jest.fn(async (v: any) => Object.assign(settings, v)),
    update: jest.fn(async (_id: any, v: any) => Object.assign(settings, v)),
  };
  const bate = (a: any, w: any) => Object.entries(w).every(([k, v]) => a[k] === v);
  const assignRepo: any = {
    findOne: jest.fn(async ({ where }: any) => assignments.find((a) => (Array.isArray(where) ? where : [where]).some((w: any) => bate(a, w))) || null),
    find: jest.fn(async ({ where }: any = {}) => assignments.filter((a) => !where || a.status === where.status)),
    create: jest.fn((v: any) => v),
    save: jest.fn(async (v: any) => {
      if (!assignments.includes(v)) assignments.push(v);
      return v;
    }),
  };
  const ids = turno ?? [];
  const usersRepo: any = {
    find: jest.fn(async () => ["A", "B", "S1", "S2", "S3"].map((id) => ({ id, active: true, approved: true, role: "corretor" }))),
    findOne: jest.fn(async () => null),
  };
  const svc = new LeadQueueService(
    settingsRepo,
    assignRepo,
    { update: jest.fn(async () => ({})), findOne: jest.fn(async () => ({ id: "c1", naoLead: false })) } as any,
    usersRepo,
    { update: jest.fn(async () => ({})), findOne: jest.fn(async () => lead) } as any,
    { update: jest.fn(async () => ({})), findOne: jest.fn(async () => null) } as any,
    { turnoAtivo: jest.fn(async () => (turno ? { atendenteIds: ids } : null)) } as any,
    { addMessage: jest.fn(async () => ({})) } as any,
    { sendText: jest.fn(async () => ({})) } as any,
    { get: jest.fn(() => undefined) } as any
  );
  return { svc, assignments, settings };
}

const base = () => ({ id: "s", enabled: true, slaMinutes: 5, pointer: 0, swatMemberIds: ["S1", "S2"], swatPointer: 0 });

describe("Fila SWAT (11/11)", () => {
  it("lead SWAT vai só pros SWAT de plantão, com 15 min", async () => {
    const m = make(base(), [], ["A", "S2", "B"]);
    const a = await m.svc.enqueueLead({ conversationId: "c1", leadId: "L1", swat: true });
    expect(a).toMatchObject({ assignedToId: "S2", status: "pendente", swat: true });
    const min = (new Date(a!.dueAt).getTime() - Date.now()) / 60_000;
    expect(Math.round(min)).toBe(SWAT_SLA_MIN);
  });

  it("nenhum SWAT de plantão: lead SWAT espera (não vai pra fila normal)", async () => {
    const m = make(base(), [], ["A", "B"]);
    const a = await m.svc.enqueueLead({ conversationId: "c1", leadId: "L1", swat: true });
    expect(a).toMatchObject({ status: "aguardando", assignedToId: "", swat: true });
    // Turno abre só com corretores normais: continua esperando.
    expect(await m.svc.liberarAguardando()).toBe(0);
  });

  it("SWAT entrou no plantão: o lead que esperava vai pra ele", async () => {
    const m = make(base(), [{ conversationId: "c1", leadId: "L1", status: "aguardando", assignedToId: "", attempts: 0, swat: true }], ["A", "S1"]);
    expect(await m.svc.liberarAguardando()).toBe(1);
    expect(m.assignments[0]).toMatchObject({ status: "pendente", assignedToId: "S1" });
  });

  it("prazo venceu: passa pro próximo SWAT, nunca pra corretor normal", async () => {
    const m = make(base(), [{ conversationId: "c1", leadId: "L1", status: "pendente", assignedToId: "S1", dueAt: new Date(0), attempts: 1, swat: true }], ["A", "S1", "S2", "B"]);
    await m.svc.reassignExpired();
    expect(m.assignments[1]).toMatchObject({ assignedToId: "S2", status: "pendente", swat: true });
  });

  it("IA qualificou: lead esperando corretor da fila normal passa pra SWAT", async () => {
    const m = make(base(), [{ conversationId: "c1", leadId: "L1", status: "pendente", assignedToId: "A", dueAt: new Date(Date.now() + 60_000), attempts: 1, swat: false }], ["A", "S1"]);
    expect(await m.svc.promoverSwat("L1")).toBe(true);
    expect(m.assignments[0].status).toBe("expirado");
    expect(m.assignments[1]).toMatchObject({ assignedToId: "S1", swat: true });
  });

  it("IA qualificou mas o corretor já atendeu: não mexe", async () => {
    const m = make(base(), [{ conversationId: "c1", leadId: "L1", status: "atendido", assignedToId: "A", attempts: 1, swat: false }], ["A", "S1"]);
    expect(await m.svc.promoverSwat("L1")).toBe(false);
  });

  it("lista SWAT: só corretor ativo, sem repetir, máximo 16", async () => {
    const m = make(base(), [], ["A"]);
    const muitos = Array.from({ length: 20 }, (_, i) => `X${i}`);
    (m.svc as any).usersRepo.find = jest.fn(async () => muitos.map((id) => ({ id, active: true, approved: true, role: "corretor" })));
    const s = await m.svc.updateSettings({ swatMemberIds: [...muitos, "X1"] });
    expect(s.swatMemberIds).toHaveLength(16);
  });
});
