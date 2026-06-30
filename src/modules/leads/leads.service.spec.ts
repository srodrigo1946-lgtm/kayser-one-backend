import { LeadsService } from "./leads.service";
import { LeadHistoryType } from "../lead-history/lead-history.entity";
import { UserRole } from "../users/user.entity";

describe("LeadsService", () => {
  let leadsRepo: any;
  let history: any;
  let users: any;
  let service: LeadsService;

  const diretor = { id: "u1", name: "Rodrigo", role: UserRole.DIRETOR } as any;

  beforeEach(() => {
    leadsRepo = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: "l1", ...x })),
      findOne: jest.fn(),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    history = { log: jest.fn(), findByLead: jest.fn() };
    users = { getScopeIds: jest.fn().mockResolvedValue(null) };
    service = new LeadsService(leadsRepo, history, users);
  });

  it("registra histórico de criação ao criar um lead", async () => {
    await service.create({ name: "Maria", phone: "11999990000" } as any, diretor);
    expect(history.log).toHaveBeenCalledWith(
      expect.objectContaining({ type: LeadHistoryType.CRIACAO, userId: "u1", leadId: "l1" })
    );
  });

  it("registra mudança de status no histórico quando o status muda", async () => {
    leadsRepo.findOne.mockResolvedValue({ id: "l1", status: "novo_lead" });
    leadsRepo.save.mockImplementation(async (x: any) => x);

    await service.updateStatus("l1", "em_atendimento", 0, diretor);

    expect(history.log).toHaveBeenCalledWith(
      expect.objectContaining({
        type: LeadHistoryType.MUDANCA_STATUS,
        fromStatus: "novo_lead",
        toStatus: "em_atendimento",
      })
    );
  });

  it("não registra histórico quando o status não muda", async () => {
    leadsRepo.findOne.mockResolvedValue({ id: "l1", status: "novo_lead" });
    leadsRepo.save.mockImplementation(async (x: any) => x);

    await service.updateStatus("l1", "novo_lead", 0, diretor);

    expect(history.log).not.toHaveBeenCalled();
  });

  it("corretor só enxerga os próprios leads (filtro por hierarquia)", async () => {
    users.getScopeIds.mockResolvedValue(["c1"]);
    await service.findAll({ user: { id: "c1", role: UserRole.CORRETOR } as any });
    const arg = leadsRepo.findAndCount.mock.calls[0][0];
    // responsavelId vira um operador In(["c1"]) quando há escopo de equipe.
    expect((arg.where.responsavelId as any).value).toEqual(["c1"]);
  });
});
