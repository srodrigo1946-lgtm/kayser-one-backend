import { ConversationsService, LINK_ANUNCIO } from "./conversations.service";
import { LeadStatus } from "../leads/lead.entity";

// Cliente que manda link de Facebook/Instagram sai do Kayser One (Rodrigo 09/11).
describe("Link de anúncio do Facebook/Instagram (09/11)", () => {
  it("reconhece links do Facebook e Instagram, e não outros", () => {
    expect(LINK_ANUNCIO.test("https://www.facebook.com/share/r/1CD5kqkLDx/")).toBe(true);
    expect(LINK_ANUNCIO.test("olha isso https://fb.me/abc")).toBe(true);
    expect(LINK_ANUNCIO.test("https://www.instagram.com/reel/xyz/")).toBe(true);
    expect(LINK_ANUNCIO.test("https://m.facebook.com/story.php?id=1")).toBe(true);
    expect(LINK_ANUNCIO.test("quero saber do Ilha stay, vi no facebook")).toBe(false);
    expect(LINK_ANUNCIO.test("https://www.google.com/maps/x")).toBe(false);
  });

  function montar(status: LeadStatus | null) {
    const convRepo: any = { update: jest.fn(async () => ({})), query: jest.fn() };
    const leadsRepo: any = {
      findOne: jest.fn(async () => (status ? { id: "L1", status } : null)),
      delete: jest.fn(async () => ({})),
    };
    const svc = new ConversationsService(convRepo, {} as any, leadsRepo, {} as any, {} as any, {} as any, {} as any);
    return { svc, convRepo, leadsRepo };
  }

  it("lead no começo do funil: marca não é lead e apaga o lead", async () => {
    const { svc, convRepo, leadsRepo } = montar(LeadStatus.PRIMEIRO_CONTATO);
    const tirou = await svc.removerSeLinkAnuncio({ id: "c1", leadId: "L1", isGroup: false, naoLead: false } as any, "https://www.facebook.com/share/r/1/");
    expect(tirou).toBe(true);
    expect(convRepo.update).toHaveBeenCalledWith("c1", expect.objectContaining({ naoLead: true, leadId: null }));
    expect(leadsRepo.delete).toHaveBeenCalledWith({ id: "L1" });
  });

  it("lead negociando (agendamento em diante) fica", async () => {
    const { svc, convRepo } = montar(LeadStatus.AGENDAMENTO);
    const tirou = await svc.removerSeLinkAnuncio({ id: "c1", leadId: "L1", isGroup: false, naoLead: false } as any, "https://fb.me/x");
    expect(tirou).toBe(false);
    expect(convRepo.update).not.toHaveBeenCalled();
  });

  it("mensagem sem link não faz nada", async () => {
    const { svc, convRepo } = montar(LeadStatus.NOVO_LEAD);
    expect(await svc.removerSeLinkAnuncio({ id: "c1", leadId: "L1", isGroup: false } as any, "oi, tenho interesse")).toBe(false);
    expect(convRepo.update).not.toHaveBeenCalled();
  });

  it("limpeza: prévia só lista; confirmar tira cada um", async () => {
    const { svc, convRepo, leadsRepo } = montar(null);
    convRepo.query.mockResolvedValue([
      { id: "c1", leadId: "L1", nome: "Terezinha", status: "primeiro_contato", responsavel: "Claudia", content: "https://www.facebook.com/share/r/1/" },
      { id: "c1", leadId: "L1", nome: "Terezinha", status: "primeiro_contato", responsavel: "Claudia", content: "https://fb.me/2" },
      { id: "c2", leadId: null, nome: "Zé", status: null, responsavel: null, content: "vai se ferrar" },
      { id: "c3", leadId: "L3", nome: "Ana", status: "novo_lead", responsavel: null, content: "computador para de funcionar?" },
    ]);
    const previa = await svc.limparLinksAnuncio(false);
    // c1 conta 1 vez (2 links), c2 por palavrão, c3 não (pré-filtro pegou "para de", regra não)
    expect(previa).toMatchObject({ total: 2, removidos: 0 });
    expect(previa.itens.map((i: any) => i.motivo)).toEqual(["link", "ofensa"]);
    expect(convRepo.update).not.toHaveBeenCalled();
    const feito = await svc.limparLinksAnuncio(true);
    expect(feito).toMatchObject({ total: 2, removidos: 2 });
    expect(leadsRepo.delete).toHaveBeenCalledWith({ id: "L1" });
  });

  it("palavrão e mensagem agressiva contam (com ou sem acento); conversa normal não", async () => {
    const { temOfensa } = await import("./conversations.service");
    for (const t of ["Vai tomar no c*", "seu otário", "PORRA", "filho da puta", "isso é golpe", "para de me mandar mensagem", "não me mande mais nada", "vsf"]) {
      expect([t, temOfensa(t)]).toEqual([t, true]);
    }
    for (const t of ["não tenho interesse", "não", "computador", "quero saber do parcelamento", "pode mandar o valor?", "Cuiabá", "otimo, obrigado"]) {
      expect([t, temOfensa(t)]).toEqual([t, false]);
    }
  });

  it("conversa antiga sem lead (família, equipe) não é mexida; contato novo sem lead sai", async () => {
    const a = montar(null);
    const antiga = { id: "c7", leadId: null, isGroup: false, createdAt: new Date(Date.now() - 5 * 86_400_000) } as any;
    expect(await a.svc.removerSeLinkAnuncio(antiga, "PQP kkkk")).toBe(false);
    const b = montar(null);
    const nova = { id: "c8", leadId: null, isGroup: false, createdAt: new Date() } as any;
    expect(await b.svc.removerSeLinkAnuncio(nova, "https://fb.me/x")).toBe(true);
  });

  it("palavrão do cliente tira do CRM (lead no começo do funil)", async () => {
    const { svc, convRepo } = montar(LeadStatus.NOVO_LEAD);
    expect(await svc.removerSeLinkAnuncio({ id: "c9", leadId: "L1", isGroup: false } as any, "vai se fuder")).toBe(true);
    expect(convRepo.update).toHaveBeenCalledWith("c9", expect.objectContaining({ naoLead: true }));
  });
});
