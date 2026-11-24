import { DiscadorService, mensagemNaoAtendeu, vaiProWhatsapp } from "./discador.service";

describe("Discador", () => {
  it("não atendeu e caixa postal vão pro WhatsApp; atendeu não", () => {
    expect(vaiProWhatsapp("nao_atendeu")).toBe(true);
    expect(vaiProWhatsapp("caixa_postal")).toBe(true);
    expect(vaiProWhatsapp("atendeu")).toBe(false);
    expect(vaiProWhatsapp("numero_invalido")).toBe(false);
  });

  it("mensagem usa o primeiro nome do cliente e do corretor", () => {
    expect(mensagemNaoAtendeu("Ana Paula Souza", "Diego Fernandes")).toContain("Oi Ana,");
    expect(mensagemNaoAtendeu("Ana Paula Souza", "Diego Fernandes")).toContain("Aqui é Diego, da Kayser");
  });

  it("caixa postal manda WhatsApp e grava a ligação; lead de fora da equipe é barrado", async () => {
    const qs: any[] = [];
    const leads = {
      findOne: async () => ({ id: "L1", name: "Ana", phone: "21999990000", responsavelId: "c1", naoPerturbe: false }),
      query: async (q: string, p: any[]) => (qs.push([q, p]), [{ id: "x" }]),
    } as any;
    const sendText = jest.fn().mockResolvedValue(null);
    const conversations = {
      diretorCentralId: async () => "dir",
      findOrCreateByPhone: async () => ({ id: "cv", leadId: "L1" }),
      addMessage: async () => null,
    } as any;
    const s = new DiscadorService(
      leads,
      {} as any,
      { getScopeIds: async () => ["c1"] } as any,
      {} as any,
      conversations,
      { sendText } as any,
      { log: async () => null } as any
    );
    const r = await s.registrar({ id: "c1", name: "Diego" } as any, { leadId: "L1", resultado: "caixa_postal" });
    expect(r.whatsappEnviado).toBe(true);
    expect(sendText).toHaveBeenCalledWith("user_dir", expect.any(String), expect.stringContaining("Tentei te ligar"));
    expect(qs[0][1]).toEqual(["L1", "c1", "caixa_postal", null, null, true]);

    const fora = new DiscadorService(leads, {} as any, { getScopeIds: async () => ["outro"] } as any, {} as any, conversations, { sendText } as any, { log: async () => null } as any);
    await expect(fora.registrar({ id: "outro" } as any, { leadId: "L1", resultado: "atendeu" })).rejects.toThrow("não é seu");
  });
});
