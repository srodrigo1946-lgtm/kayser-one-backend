import { CorujaoService } from "./corujao.service";
import { UserRole } from "../users/user.entity";
import { LeadStatus } from "../leads/lead.entity";

function make(lead: any = { id: "L1", name: "Ney", status: "cliente_sem_interesse" }) {
  const leadsRepo: any = {
    findOne: jest.fn(async () => lead),
    save: jest.fn(async (x) => x),
    find: jest.fn(async () => [lead]),
  };
  const convRepo: any = { update: jest.fn(async () => ({})) };
  const usersRepo: any = {
    findOne: jest.fn(async () => ({ id: "d1", role: UserRole.DIRETOR })),
    find: jest.fn(async () => []),
    update: jest.fn(async () => ({})),
  };
  const columnsRepo: any = { find: jest.fn(async () => [{ key: "cliente_sem_interesse", title: "Cliente sem interesse" }]) };
  const settings: any = {
    get: jest.fn(async () => ({ corujaoIncluirDiretor: false, corujaoStatus: "cliente_sem_interesse" })),
    update: jest.fn(async () => ({})),
  };
  const history: any = { log: jest.fn(async () => ({})) };
  const config: any = { get: jest.fn(() => undefined) };
  return {
    svc: new CorujaoService(leadsRepo, convRepo, usersRepo, columnsRepo, settings, history, config),
    leadsRepo,
    convRepo,
    history,
  };
}

describe("CorujaoService", () => {
  it("todos veem o pool, mas só corretor ativado pode pegar", async () => {
    const { svc } = make();
    const gerente = await svc.getPool({ id: "g1", role: UserRole.GERENTE, corujao: false } as any);
    expect(gerente.podePegar).toBe(false);
    expect(gerente.leads.length).toBe(1);
    const corretor = await svc.getPool({ id: "c1", role: UserRole.CORRETOR, corujao: true } as any);
    expect(corretor.podePegar).toBe(true);
  });

  it("não-corretor (ou corretor não ativado) NÃO pode aceitar", async () => {
    const { svc } = make();
    await expect(
      svc.aceitar("L1", { id: "g1", role: UserRole.GERENTE, corujao: false } as any)
    ).rejects.toThrow(/corretores ativados/i);
    await expect(
      svc.aceitar("L1", { id: "c2", role: UserRole.CORRETOR, corujao: false } as any)
    ).rejects.toThrow(/corretores ativados/i);
  });

  it("corretor ativado aceita: lead vira dele e volta pra Novo Lead", async () => {
    const { svc, leadsRepo, convRepo, history } = make();
    const r = await svc.aceitar("L1", { id: "c1", name: "Ana", role: UserRole.CORRETOR, corujao: true } as any);
    expect(r.ok).toBe(true);
    const saved = leadsRepo.save.mock.calls[0][0];
    expect(saved.responsavelId).toBe("c1");
    expect(saved.status).toBe(LeadStatus.NOVO_LEAD);
    expect(convRepo.update).toHaveBeenCalledWith({ leadId: "L1" }, { assignedToId: "c1" });
    expect(history.log).toHaveBeenCalled();
  });
});
