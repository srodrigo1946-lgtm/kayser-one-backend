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

  it("cada cargo lista só a própria agenda (gestor não vê a do time)", async () => {
    users.getScopeIds.mockResolvedValue(["g1", "c1", "c2"]);
    await service.findAll({ id: "g1", role: UserRole.GERENTE } as any);
    const arg = repo.find.mock.calls[0][0];
    expect(arg.where).toEqual([{ userId: "g1" }]);
  });

  it("diretor vê a própria agenda + visitas sem dono (IA), não a de todos", async () => {
    await service.findAll({ id: "d1", role: UserRole.DIRETOR } as any);
    const arg = repo.find.mock.calls[0][0];
    expect(arg.where).toHaveLength(2);
    expect(arg.where[0]).toEqual({ userId: "d1" });
    expect(arg.where[1].userId).toBeDefined(); // IsNull()
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
