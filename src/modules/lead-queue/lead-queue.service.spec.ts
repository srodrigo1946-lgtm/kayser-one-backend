import { LeadQueueService } from "./lead-queue.service";

// `validUserIds` = quem REALMENTE existe no banco. Por padrão, todos os membros
// da fila existem; passe uma lista menor para simular usuário apagado/inativo.
function make(settings: any, assignments: any[] = [], validUserIds?: string[]) {
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
    find: jest.fn(async () => assignments.filter((a) => a.status === "pendente")),
    create: jest.fn((v) => v),
    save: jest.fn(async (v) => {
      if (!assignments.includes(v)) assignments.push(v);
      return v;
    }),
  };
  const convRepo: any = { update: jest.fn(async () => ({})) };
  const idsValidos: string[] = validUserIds ?? settings.memberIds ?? [];
  const usersRepo: any = {
    find: jest.fn(async () => idsValidos.map((id) => ({ id, active: true, approved: true }))),
  };
  return {
    svc: new LeadQueueService(settingsRepo, assignRepo, convRepo, usersRepo),
    settings,
    assignments,
    convRepo,
  };
}

describe("LeadQueueService", () => {
  it("enqueueAdLead atribui ao próximo e avança o ponteiro", async () => {
    const { svc, settings, convRepo } = make({ enabled: true, slaMinutes: 5, memberIds: ["A", "B", "C"], pointer: 0 });
    const a1 = await svc.enqueueAdLead({ conversationId: "c1" });
    expect(a1?.assignedToId).toBe("A");
    expect(settings.pointer).toBe(1);
    expect(convRepo.update).toHaveBeenCalledWith("c1", { assignedToId: "A" });

    const a2 = await svc.enqueueAdLead({ conversationId: "c2" });
    expect(a2?.assignedToId).toBe("B");
    expect(settings.pointer).toBe(2);
  });

  it("enqueueAdLead retorna null quando a fila está desligada", async () => {
    const { svc } = make({ enabled: false, slaMinutes: 5, memberIds: ["A"], pointer: 0 });
    expect(await svc.enqueueAdLead({ conversationId: "c1" })).toBeNull();
  });

  it("enqueueAdLead retorna null sem membros", async () => {
    const { svc } = make({ enabled: true, slaMinutes: 5, memberIds: [], pointer: 0 });
    expect(await svc.enqueueAdLead({ conversationId: "c1" })).toBeNull();
  });

  // Usuário apagado continuava no rodízio e recebia leads que ninguém via:
  // o lead sumia até o prazo estourar. Foi a causa de "0 atendidos" em produção.
  it("pula membro que não existe mais e o remove do rodízio", async () => {
    const { svc, settings } = make(
      { enabled: true, slaMinutes: 5, memberIds: ["fantasma", "B", "C"], pointer: 0 },
      [],
      ["B", "C"] // "fantasma" foi apagado do banco
    );
    const a1 = await svc.enqueueAdLead({ conversationId: "c1" });
    expect(a1?.assignedToId).toBe("B");
    expect(settings.memberIds).toEqual(["B", "C"]);
  });

  it("não distribui quando TODOS os membros foram apagados", async () => {
    const { svc } = make({ enabled: true, slaMinutes: 5, memberIds: ["x", "y"], pointer: 0 }, [], []);
    expect(await svc.enqueueAdLead({ conversationId: "c1" })).toBeNull();
  });

  it("markAttended encerra o SLA quando o cargo atribuído responde", async () => {
    const pending = { conversationId: "c1", assignedToId: "A", status: "pendente" };
    const { svc } = make({ enabled: true, slaMinutes: 5, memberIds: ["A", "B"], pointer: 0 }, [pending]);
    expect(await svc.markAttended("c1", "A")).toBe(true);
    expect(pending.status).toBe("atendido");
  });

  it("markAttended não marca se o usuário não é o atribuído", async () => {
    const pending = { conversationId: "c2", assignedToId: "A", status: "pendente" };
    const { svc } = make({ enabled: true, slaMinutes: 5, memberIds: ["A", "B"], pointer: 0 }, [pending]);
    expect(await svc.markAttended("c2", "B")).toBe(false);
    expect(pending.status).toBe("pendente");
  });
});
