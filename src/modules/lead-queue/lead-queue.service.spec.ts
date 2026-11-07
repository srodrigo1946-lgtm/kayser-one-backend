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
    update: jest.fn(async (_id: any, v: any) => {
      Object.assign(settings, v);
      return {};
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
  const convRepo: any = { update: jest.fn(async () => ({})), findOne: jest.fn(async () => ({ id: "c", naoLead: false })) };
  const idsValidos: string[] = validUserIds ?? turno ?? [];
  const usersRepo: any = {
    find: jest.fn(async () =>
      idsValidos.map((id) => ({ id, active: true, approved: true, role: rolesById[id] ?? "corretor" }))
    ),
    findOne: jest.fn(async () => null),
  };
  const leadsRepo: any = {
    update: jest.fn(async () => ({})),
    findOne: jest.fn(async () => lead),
  };
  const apptRepo: any = { update: jest.fn(async () => ({})), findOne: jest.fn(async () => null) };
  const escala: any = { turnoAtivo: jest.fn(async () => (turno ? { atendenteIds: turno } : null)) };
  const conversations: any = {
    findOrCreateByPhone: jest.fn(async (phone: string) => ({ id: `conv-${phone}`, leadId: null })),
    setLead: jest.fn(async () => ({})),
    addMessage: jest.fn(async () => ({})),
  };
  const whatsapp: any = { sendText: jest.fn(async () => ({})) };
  const config: any = { get: jest.fn(() => undefined) };
  return {
    svc: new LeadQueueService(settingsRepo, assignRepo, convRepo, usersRepo, leadsRepo, apptRepo, escala, conversations, whatsapp, config),
    settings,
    assignments,
    convRepo,
    leadsRepo,
  };
}

describe("Nome do corretor pro cliente (07/11)", () => {
  it("pula 'de/da/dos' e não corta no meio", () => {
    const { nomeCurto } = require("./lead-queue.service");
    expect(nomeCurto("Anita de Alvarenga Silva")).toBe("Anita Alvarenga");
    expect(nomeCurto("Diego Pontes Sampaio ")).toBe("Diego Pontes");
    expect(nomeCurto("Carlos")).toBe("Carlos");
  });
  it("lead passou pro próximo da fila: o cliente NÃO recebe mensagem de troca", async () => {
    const m = make({ enabled: true, slaMinutes: 15, pointer: 0 }, [{ conversationId: "c1", leadId: "L1", status: "pendente", assignedToId: "A", dueAt: new Date(0), attempts: 1 }], ["A", "B"], undefined, {}, { id: "L1", status: "novo_lead" });
    await m.svc.reassignExpired();
    expect(m.assignments[1]).toMatchObject({ assignedToId: "B", status: "pendente" });
    expect((m.svc as any).whatsapp.sendText).not.toHaveBeenCalled();
  });
});

describe("WhatsApp caiu e voltou (07/11)", () => {
  function montar(conectado: boolean, caiuEm: Date | null) {
    const m = make({ id: "s", enabled: true, slaMinutes: 15, pointer: 0, whatsappCaiuEm: caiuEm }, [{ conversationId: "conv-L1", leadId: "L1", status: "pendente", assignedToId: "A" }], ["A", "B"]);
    const svc: any = m.svc;
    svc.conversations.diretorCentralId = async () => "D";
    svc.whatsapp.conectado = async () => conectado;
    svc.leadsRepo.find = jest.fn(async () => [{ id: "L1", status: "em_atendimento" }, { id: "L2", status: "novo_lead" }]);
    svc.convRepo.findOne = jest.fn(async ({ where }: any) => ({ id: `conv-${where.leadId}` }));
    // L2: o cliente respondeu → já foi atendido, não volta.
    svc.convRepo.query = jest.fn(async (_q: string, [c]: any) => (c === "conv-L2" ? [1] : []));
    svc.assignRepo.update = jest.fn(async () => {
      m.assignments[0].status = "expirado";
    });
    return m;
  }
  it("caiu: anota a hora e não mexe nos leads", async () => {
    const m = montar(false, null);
    expect(await m.svc.vigiarWhatsapp()).toBe(0);
    expect(m.settings.whatsappCaiuEm).toBeInstanceOf(Date);
  });
  it("voltou depois de horas fora: lead em Novo Lead volta pra fila com corretor novo", async () => {
    const m = montar(true, new Date(Date.now() - 7 * 3600_000));
    expect(await m.svc.vigiarWhatsapp()).toBe(1);
    expect(m.settings.whatsappCaiuEm).toBeNull();
    expect(m.assignments[0].status).toBe("expirado");
    expect(m.assignments[1]).toMatchObject({ leadId: "L1", status: "pendente" });
    expect(m.leadsRepo.update).toHaveBeenCalledWith("L1", { status: "novo_lead" }); // estava Em atendimento sem resposta
  });
  it("piscada de poucos minutos: não mexe", async () => {
    const m = montar(true, new Date(Date.now() - 3 * 60_000));
    expect(await m.svc.vigiarWhatsapp()).toBe(0);
    expect(m.assignments).toHaveLength(1);
  });
});

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
    const { svc } = make({ enabled: true, slaMinutes: 5, pointer: 0 }, [aguardando], ["A"], undefined, {}, { id: "l1", status: "novo_lead" });
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

  it("SLA repassado conta como a vez: o 'Próximo' anda pro seguinte a quem recebeu", async () => {
    const settings = { id: "s", enabled: true, slaMinutes: 5, pointer: 1 }; // próximo = B
    const venc = { conversationId: "c1", leadId: "L1", assignedToId: "A", status: "pendente", dueAt: new Date(Date.now() - 1000), attempts: 1 };
    const { svc } = make(settings, [venc], ["A", "B", "C"], undefined, {}, { id: "L1", status: "novo_lead" });
    await svc.reassignExpired(); // A → B
    expect(settings.pointer).toBe(2); // próximo lead novo vai pro C, não pro B de novo
  });

  it("SLA: lead excluído / 'não é lead' encerra a atribuição sem reenviar nem repassar", async () => {
    const venc = { conversationId: "c1", leadId: "L1", assignedToId: "A", status: "pendente", dueAt: new Date(Date.now() - 1000), attempts: 1 };
    const { svc, assignments } = make(
      { enabled: true, slaMinutes: 5, pointer: 0 },
      [venc], ["A", "B"], undefined, {}, null // lead=null → excluído
    );
    await svc.reassignExpired();
    expect(venc.status).toBe("atendido");
    // Não cria nova atribuição (não repassa pro próximo).
    expect(assignments.filter((x) => x.status === "pendente").length).toBe(0);
  });

  it("mensagem do corretor: Novo Lead vira Primeiro Contato e encerra os 15 min", async () => {
    const { svc, leadsRepo } = make({ enabled: true, slaMinutes: 15, pointer: 0 });
    const assignUpd = jest.fn(async () => ({}));
    (svc as any).assignRepo.update = assignUpd;
    leadsRepo.manager = { getRepository: () => ({ save: async () => ({}) }) };
    leadsRepo.update = jest.fn(async () => ({ affected: 1 }));
    expect(await svc.primeiroContatoDoCorretor("L1")).toBe(true);
    expect(leadsRepo.update).toHaveBeenCalledWith({ id: "L1", status: "novo_lead" }, { status: "primeiro_contato" });
    expect(assignUpd).toHaveBeenCalledWith({ leadId: "L1", status: "pendente" }, { status: "atendido" });
    // Lead já em outra etapa: não mexe em nada.
    leadsRepo.update = jest.fn(async () => ({ affected: 0 }));
    assignUpd.mockClear();
    expect(await svc.primeiroContatoDoCorretor("L2")).toBe(false);
    expect(assignUpd).not.toHaveBeenCalled();
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

  it("agendarLead deixa o lead aguardando com o horário marcado", async () => {
    const { svc, assignments } = make(
      { enabled: true, slaMinutes: 5, pointer: 0 },
      [], ["A"], undefined, {}, { id: "L1", name: "Ney", phone: "21997786952" }
    );
    const daqui2h = new Date(Date.now() + 2 * 3600_000);
    const r = await svc.agendarLead("L1", daqui2h);
    expect(r.status).toBe("agendado");
    expect(assignments[0].status).toBe("aguardando");
    expect(assignments[0].agendadoPara).toBe(daqui2h);
  });

  it("agendarLead recusa horário no passado", async () => {
    const { svc } = make(
      { enabled: true, slaMinutes: 5, pointer: 0 },
      [], ["A"], undefined, {}, { id: "L1", name: "Ney", phone: "21997786952" }
    );
    expect((await svc.agendarLead("L1", new Date(Date.now() - 1000))).status).toBe("horario_invalido");
  });

  it("liberarAguardando segura o lead agendado até o horário e solta depois", async () => {
    const futuro = { conversationId: "c1", leadId: "l1", status: "aguardando", assignedToId: "", agendadoPara: new Date(Date.now() + 3600_000) };
    const { svc } = make({ enabled: true, slaMinutes: 5, pointer: 0 }, [futuro], ["A"], undefined, {}, { id: "l1", status: "novo_lead" });
    await svc.liberarAguardando();
    expect(futuro.status).toBe("aguardando"); // ainda não chegou a hora

    futuro.agendadoPara = new Date(Date.now() - 1000); // horário passou
    await svc.liberarAguardando();
    expect(futuro.status).toBe("pendente");
    expect(futuro.assignedToId).toBe("A");
  });

  it("distribuirLeadManual com a fila desligada não distribui", async () => {
    const { svc } = make(
      { enabled: false, slaMinutes: 5, pointer: 0 },
      [], ["A"], undefined, {}, { id: "L1", name: "Ney", phone: "21997786952" }
    );
    expect((await svc.distribuirLeadManual("L1")).status).toBe("fila_desligada");
  });
});
