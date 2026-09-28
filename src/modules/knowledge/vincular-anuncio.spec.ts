import { KnowledgeService } from "./knowledge.service";
import { Property } from "../properties/property.entity";
import { Lead } from "../leads/lead.entity";
import { LeadHistory } from "../lead-history/lead-history.entity";

/** Monta o serviço com um "banco" em memória: imóveis + um lead vindo de anúncio. */
function montar(lead: Partial<Lead>) {
  const props = [
    { id: "p1", name: "Renascença Residencial", bairro: "", cidade: "", standAddress: "Rua Barão de São Francisco, 177 – Andaraí", active: true },
    { id: "p2", name: "Ilha stay home Resort", bairro: "Barra Olímpica", cidade: "Rio de Janeiro", active: true },
  ];
  const leadsRepo = {
    findOne: jest.fn(async () => lead),
    update: jest.fn(async (_id: string, dados: Partial<Lead>) => Object.assign(lead, dados)),
  };
  const historico = { save: jest.fn(async () => ({})) };
  const manager = {
    getRepository: (ent: unknown) =>
      ent === Property
        ? { find: jest.fn(async () => props), findOne: jest.fn(async ({ where }: any) => props.find((p) => p.id === where.id)) }
        : ent === Lead
          ? leadsRepo
          : ent === LeadHistory
            ? historico
            : {},
  };
  const svc = new KnowledgeService({ manager } as any, {} as any, {} as any, {} as any, {} as any);
  return { svc, lead, leadsRepo, historico };
}

describe("vincularAoAnuncio (lead que chega por anúncio)", () => {
  it("anúncio sem o nome do imóvel: pergunta à IA e registra o lead (caso 'Grande Tijuca')", async () => {
    const { svc, lead } = montar({ id: "L1", source: "anuncio" as any, campanha: "No coração Grande Tijuca" });
    const ia = jest.fn(async (_a: string, opcoes: string) => {
      expect(opcoes).toContain("Andaraí"); // a IA recebe o endereço do stand pra cruzar a região
      return "Renascença Residencial";
    });
    const nome = await svc.vincularAoAnuncio("L1", "No coração Grande Tijuca", "No coração da Grande Tijuca", ia);
    expect(nome).toBe("Renascença Residencial");
    expect(lead.propertyId).toBe("p1");
    expect(lead.empreendimento).toBe("Renascença Residencial");
  });

  it("anúncio que cita o nome: registra sem chamar a IA", async () => {
    const { svc, lead } = montar({ id: "L2", source: "anuncio" as any });
    const ia = jest.fn();
    expect(await svc.vincularAoAnuncio("L2", "Ilha Stay Home Resort — lançamento", "", ia)).toBe("Ilha stay home Resort");
    expect(ia).not.toHaveBeenCalled();
    expect(lead.propertyId).toBe("p2");
  });

  it("lead que já tem imóvel não é trocado", async () => {
    const { svc, leadsRepo } = montar({ id: "L3", propertyId: "p2" });
    expect(await svc.vincularAoAnuncio("L3", "No coração Grande Tijuca", "", jest.fn())).toBeNull();
    expect(leadsRepo.update).not.toHaveBeenCalled();
  });

  it("contexto pro Kayser manda falar direto do empreendimento, sem perguntar", async () => {
    const { svc } = montar({ id: "L4", source: "anuncio" as any, campanha: "No coração Grande Tijuca", propertyId: "p1" });
    const ctx = await svc.contextoDoLead("L4");
    expect(ctx).toContain("Renascença Residencial");
    expect(ctx).toContain("NÃO pergunte qual empreendimento");
  });
});
