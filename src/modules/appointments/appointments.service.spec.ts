import { AppointmentsService } from "./appointments.service";
import { UserRole } from "../users/user.entity";

describe("AppointmentsService", () => {
  let repo: any;
  let users: any;
  let service: AppointmentsService;

  beforeEach(() => {
    repo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: "a1", ...x })),
      remove: jest.fn(),
    };
    users = { getScopeIds: jest.fn().mockResolvedValue(null) };
    service = new AppointmentsService(repo, users);
  });

  it("usa o criador como responsável quando userId não é informado", async () => {
    await service.create({ title: "Visita", scheduledAt: new Date() } as any, { id: "u1" } as any);
    const arg = repo.create.mock.calls[0][0];
    expect(arg.userId).toBe("u1");
  });

  it("respeita userId explícito (gestor agendando para outro)", async () => {
    await service.create({ title: "Visita", userId: "c2", scheduledAt: new Date() } as any, { id: "u1" } as any);
    const arg = repo.create.mock.calls[0][0];
    expect(arg.userId).toBe("c2");
  });

  it("corretor só lista os próprios agendamentos (escopo por equipe)", async () => {
    users.getScopeIds.mockResolvedValue(["c1"]);
    await service.findAll({ id: "c1", role: UserRole.CORRETOR } as any);
    const arg = repo.find.mock.calls[0][0];
    expect((arg.where.userId as any).value).toEqual(["c1"]);
  });

  it("diretor lista todos (sem filtro de usuário)", async () => {
    users.getScopeIds.mockResolvedValue(null);
    await service.findAll({ id: "d1", role: UserRole.DIRETOR } as any);
    const arg = repo.find.mock.calls[0][0];
    expect(arg.where.userId).toBeUndefined();
  });

  it("buildIcs gera um VCALENDAR válido com os dados do compromisso", () => {
    const ics = service.buildIcs({
      id: "a1",
      title: "Visita; Ana, apto 101",
      notes: "Levar contrato",
      location: "Rua X, 100",
      scheduledAt: new Date("2026-07-01T13:00:00Z"),
      durationMin: 60,
    } as any);

    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("UID:a1@kayserone");
    expect(ics).toContain("DTSTART:20260701T130000Z");
    expect(ics).toContain("DTEND:20260701T140000Z");
    // vírgula e ponto-e-vírgula escapados no SUMMARY
    expect(ics).toContain("SUMMARY:Visita\\; Ana\\, apto 101");
    expect(ics.trim().endsWith("END:VCALENDAR")).toBe(true);
  });
});
