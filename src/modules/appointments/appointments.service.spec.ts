import { AppointmentsService } from "./appointments.service";
import { UserRole } from "../users/user.entity";

describe("AppointmentsService", () => {
  let repo: any;
  let service: AppointmentsService;

  beforeEach(() => {
    repo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: "a1", ...x })),
      remove: jest.fn(),
    };
    service = new AppointmentsService(repo);
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

  it("corretor só lista os próprios agendamentos", async () => {
    await service.findAll({ id: "c1", role: UserRole.CORRETOR } as any);
    const arg = repo.find.mock.calls[0][0];
    expect(arg.where.userId).toBe("c1");
  });

  it("diretor lista todos (sem filtro de usuário)", async () => {
    await service.findAll({ id: "d1", role: UserRole.DIRETOR } as any);
    const arg = repo.find.mock.calls[0][0];
    expect(arg.where.userId).toBeUndefined();
  });
});
