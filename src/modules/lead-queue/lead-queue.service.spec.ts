import { LeadQueueService } from "./lead-queue.service";

// `turno` = atendenteIds de plantão AGORA (ou null = fora de plantão).
// `validUserIds` = quem realmente existe/está ativo (default: todos do turno).
function make(
  settings: any,
  assignments: any[] = [],
  turno: string[] | null = [],
  validUserIds?: string[],
  rolesById: Record<string, string> = {},
  lead: any = null
) {
  const settingsRepo: any = {
    findOne: jest.fn(async () => settings),
    create: jest.fn((v) => v),
    save: jest.fn(async (v) => {
      Object.assign(settings, v);
      return settings;
    }),
  };
  const assignRepo: any = {
    findOne: jest.fn(async ({ where }: any) =>
      assignments.find((a) => a.conversationId === where.conversationId && a.status === where.status) || null
    ),
    find: jest.fn(async ({ where }: any = {}) =>
      where?.status ? assignments.filter((a) => a.status === where.status) : assignments
    ),
    create: jest.fn((v) => v),
    save: jest.fn(async (v) => {
      if (!assignments.includes(v)) assignments.push(v);
      return v;
    }),
  };
  const convRepo: any = { update: jest.fn(async () => ({})) };
  const idsValidos: string[] = validUserIds ?? turno ?? [];
  const usersRepo: any = {
    find: jest.fn(async () =>
      idsValidos.map((id) => ({ id, active: true, approved: true, role: rolesById[id] ?? "corretor" }))
    ),
  };
  const leadsRepo: any = {
    update: jest.fn(async () => ({})),
    findOne: jest.fn(async () => lead),
  };
  const escala: any = { turnoAtivo: jest.fn(async () => (turno ? { atendenteIds: turno } : null)) };
  const conversations: any = {
    findOrCreateByPhone: jest.fn(async (phone: string) => ({ id: `conv-${phone}`, leadId: null })),
    setLead: jest.fn(async () => ({})),
  };
  return {
    svc: new LeadQueueService(settingsRepo, assignRepo, convRepo, usersRepo, leadsRepo, escala, conversations),
    settings,
    assignments,
    convRepo,
    leadsRepo,
  };
}

describe("LeadQueueService", () => {
  it("distribui entre os atendentes do turno e avança o ponteiro", async () => {
    const { svc, settings, convRepo } = make({ enabled: true, slaMinutes: 5, pointer: 0 }, [], ["A", "B", "C"]);
    const a1 = await svc.enqueueLead({ conversationId: "c1" });
    expect(a1?.assignedToId).toBe("A");
    expect(settings.pointer).toBe(1);
    expect(convRepo.update).toHaveBeenCalledWith("c1", { assignedToId: "A" });

    const a2 = await svc.enqueueLead({ conversationId: "c2" });
    expect(a2?.assignedToId).toBe("B");
    expect(settings.pointer).toBe(2);
  });

  it("retorna null quando a fila está desligada", async () => {
    const { svc } = make({ enabled: false, slaMinutes: 5, pointer: 0 }, [], ["A"]);
    expect(await svc.enqueueLead({ conversationId: "c1" })).toBeNull();
  });

  it("fora de plantão o lead fica aguardando (sem atendente)", async () => {
    const { svc } = make({ enabled: true, slaMinutes: 5, pointer: 0 }, [], null); // turnoAtivo=null
    const a = await svc.enqueueLead({ conversationId: "c1", leadId: "l1" });
    expect(a?.status).toBe("aguardando");
    expect(a?.assignedToId).toBe("");
  });

  it("turno só com usuário inválido → aguardando", async () => {
    const { svc } = make({ enabled: true, slaMinutes: 5, pointer: 0 }, [], ["fantasma"], []);
    const a = await svc.enqueueLead({ conversationId: "c1" });
    expect(a?.status).toBe("aguardando");
  });

  it("preenche o responsável do lead ao distribuir", async () => {
    const { svc, leadsRepo } = make({ enabled: true, slaMinutes: 5, pointer: 0 }, [], ["A", "B"]);
    await svc.enqueueLead({ conversationId: "c1", leadId: "lead-1" });
    expect(leadsRepo.update).toHaveBeenCalledWith("lead-1", { responsavelId: "A" });
  });

  it("pula atendente inválido dentro do turno", async () => {
    const { svc } = make({ enabled: true, slaMinutes: 5, pointer: 0 }, [], ["fantasma", "B"], ["B"]);
    const a = await svc.enqueueLead({ conversationId: "c1" });
    expect(a?.assignedToId).toBe("B");
  });

  it("pula gerente no turno — só corretor recebe lead", async () => {
    // "ger1" está de plantão mas é gerente → ignorado; o corretor "B" recebe.
    const { svc } = make(
      { enabled: true, slaMinutes: 5, pointer: 0 },
      [],
      ["ger1", "B"],
      ["ger1", "B"],
      { ger1: "gerente" }
    );
    const a = await svc.enqueueLead({ conversationId: "c1" });
    expect(a?.assignedToId).toBe("B");
  });

  it("turno só com gerente → aguardando (ninguém corretor de plantão)", async () => {
    const { svc } = make(
      { enabled: true, slaMinutes: 5, pointer: 0 },
      [],
      ["ger1"],
      ["ger1"],
      { ger1: "gerente" }
    );
    const a = await svc.enqueueLead({ conversationId: "c1" });
    expect(a?.status).toBe("aguardando");
  });

  it("liberarAguardando distribui os represados quando abre o turno", async () => {
    const aguardando = { conversationId: "c1", leadId: "l1", status: "aguardando", assignedToId: "" };
    const { svc } = make({ enabled: true, slaMinutes: 5, pointer: 0 }, [aguardando], ["A"]);
    await svc.liberarAguardando();
    expect(aguardando.status).toBe("pendente");
    expect(aguardando.assignedToId).toBe("A");
  });

  it("SLA vencido volta a aguardar se o turno fechou", async () => {
    const venc = { conversationId: "c1", assignedToId: "A", status: "pendente", dueAt: new Date(Date.now() - 1000), attempts: 1 };
    const { svc } = make({ enabled: true, slaMinutes: 5, pointer: 0 }, [venc], null); // turno fechou
    await svc.reassignExpired();
    expect(venc.status).toBe("aguardando");
    expect(venc.assignedToId).toBe("");
  });

  it("SLA vencido NÃO repassa se o corretor moveu o lead p/ Primeiro Contato", async () => {
    const venc = { conversationId: "c1", leadId: "L1", assignedToId: "A", status: "pendente", dueAt: new Date(Date.now() - 1000), attempts: 1 };
    const { svc } = make(
      { enabled: true, slaMinutes: 5, pointer: 0 },
      [venc], ["A", "B"], undefined, {}, { id: "L1", status: "primeiro_contato" }
    );
    await svc.reassignExpired();
    expect(venc.status).toBe("atendido");
  });

  it("SLA vencido repassa pro próximo se o lead continua Novo Lead", async () => {
    const venc = { conversationId: "c1", leadId: "L1", assignedToId: "A", status: "pendente", dueAt: new Date(Date.now() - 1000), attempts: 1 };
    const { svc, assignments } = make(
      { enabled: true, slaMinutes: 5, pointer: 0 },
      [venc], ["A", "B"], undefined, {}, { id: "L1", status: "novo_lead" }
    );
    await svc.reassignExpired();
    expect(venc.status).toBe("expirado");
    expect(assignments.some((x) => x.status === "pendente" && x.assignedToId === "B")).toBe(true);
  });

  it("markAttended encerra o SLA quando o cargo atribuído responde", async () => {
    const pending = { conversationId: "c1", assignedToId: "A", status: "pendente" };
    const { svc } = make({ enabled: true, slaMinutes: 5, pointer: 0 }, [pending], ["A", "B"]);
    expect(await svc.markAttended("c1", "A")).toBe(true);
    expect(pending.status).toBe("atendido");
  });

  it("markAttended não marca se o usuário não é o atribuído", async () => {
    const pending = { conversationId: "c2", assignedToId: "A", status: "pendente" };
    const { svc } = make({ enabled: true, slaMinutes: 5, pointer: 0 }, [pending], ["A", "B"]);
    expect(await svc.markAttended("c2", "B")).toBe(false);
    expect(pending.status).toBe("pendente");
  });

  it("distribuirLeadManual joga o lead no rodízio pro corretor de plantão", async () => {
    const { svc } = make(
      { enabled: true, slaMinutes: 5, pointer: 0 },
      [], ["A"], undefined, {}, { id: "L1", name: "Ney", phone: "21997786952" }
    );
    const r = await svc.distribuirLeadManual("L1");
    expect(r.status).toBe("distribuido");
    expect(r.assignedToId).toBe("A");
  });

  it("distribuirLeadManual sem plantão → aguardando", async () => {
    const { svc } = make(
      { enabled: true, slaMinutes: 5, pointer: 0 },
      [], null, undefined, {}, { id: "L1", name: "Ney", phone: "21997786952" }
    );
    expect((await svc.distribuirLeadManual("L1")).status).toBe("aguardando");
  });

  it("distribuirLeadManual com a fila desligada não distribui", async () => {
    const { svc } = make(
      { enabled: false, slaMinutes: 5, pointer: 0 },
      [], ["A"], undefined, {}, { id: "L1", name: "Ney", phone: "21997786952" }
    );
    expect((await svc.distribuirLeadManual("L1")).status).toBe("fila_desligada");
  });
});
