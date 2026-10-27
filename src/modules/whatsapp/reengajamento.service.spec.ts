import { classificarResposta, mensagemReengajar } from "./reengajamento.service";

describe("Reengajamento dos clientes 'sem interesse'", () => {
  it("entende NÃO (sai do Kayser)", () => {
    for (const t of ["Não", "nao obrigado", "Não tenho interesse", "já comprei", "pare", "não quero mais receber mensagem", "Quero não", "agora não!"]) {
      expect(classificarResposta(t)).toBe("nao");
    }
  });
  it("entende SIM (vai pra fila)", () => {
    for (const t of ["Sim", "tenho interesse", "quero saber", "pode mandar", "me conta", "Opa, quais as condições?", "manda mais informações", "Gostei, quero saber mais", "qual o valor?", "estou interessada", "dá pra agendar uma visita?"]) {
      expect(classificarResposta(t)).toBe("sim");
    }
  });
  it("o resto segue a conversa normal", () => {
    expect(classificarResposta("quem é?")).toBe("outro");
    expect(classificarResposta("")).toBe("outro");
  });
  it("mensagens variam, usam o primeiro nome e oferecem sair", () => {
    const a = mensagemReengajar("maria silva", "Ilhamar", 0);
    const b = mensagemReengajar("maria silva", "Ilhamar", 1);
    expect(a).not.toBe(b);
    expect(a).toContain("Maria");
    expect(a).toContain("Ilhamar");
    expect(a).toContain("responder NÃO");
  });
});

describe("Fila da Equipe (25/10)", () => {
  const { ReengajamentoService, mensagemPrimeiroContato } = require("./reengajamento.service");
  function montar(lead: any, memberIds: string[] = [], pointer = 0) {
    const updates: any[] = [], sql: string[] = [], enviados: string[] = [];
    const time = [{ id: "c1", name: "Ana Souza" }, { id: "c2", name: "Bia Lima" }, { id: "c3", name: "Caio Reis" }];
    const leads: any = {
      findOne: async () => lead,
      update: async (_id: string, d: any) => updates.push(d),
      remove: async () => null,
      manager: { query: async () => [] },
      query: async (q: string, p: any[]) => {
        sql.push(q);
        if (q.includes("WITH RECURSIVE")) return time;
        if (q.includes("SELECT \"memberIds\", pointer")) return [{ memberIds: JSON.stringify(memberIds), pointer }];
        return [];
      },
    };
    const whatsapp: any = { sendText: async (_i: string, _d: string, t: string) => enviados.push(t) };
    const ai: any = { classificarInteresse: async () => "outro" };
    const s = new ReengajamentoService(leads, {} as any, {} as any, whatsapp, {} as any, ai, {} as any);
    return { s, updates, sql, enviados };
  }
  const base = { id: "L1", name: "joão", filaEquipeId: "g1", responsavelId: "g1", reengajadoEm: new Date() };

  it("SIM vai pro próximo corretor escolhido pelo gestor, com aviso e mensagem com o nome dele", async () => {
    const { s, updates, enviados } = montar({ ...base }, ["c2", "c3"], 1);
    expect(await s.tratarResposta("L1", "sim, tenho interesse", "inst", "55219")).toBe(true);
    expect(updates[0]).toEqual(expect.objectContaining({ responsavelId: "c3", transferidoPorId: "g1" }));
    expect(enviados[0]).toContain("*Caio*");
  });

  it("sem corretor no rodízio, o lead fica com o gestor (ninguém recebe)", async () => {
    const { s, updates, enviados } = montar({ ...base }, [], 0);
    expect(await s.tratarResposta("L1", "quero saber", "inst", "55219")).toBe(true);
    expect(updates).toHaveLength(0);
    expect(enviados[0]).toContain("especialista da Kayser");
  });

  it("lead de equipe nunca cai na fila central: resposta solta fica com o gestor", async () => {
    const { s, updates } = montar({ ...base });
    expect(await s.tratarResposta("L1", "quem é?", "inst", "55219")).toBe(true);
    expect(updates).toHaveLength(0);
    // já disse sim e foi pro corretor: também não mexe
    const j = montar({ ...base, responsavelId: "c1", transferidoPorId: "g1", transferidoEm: new Date(Date.now() + 1000) });
    expect(await j.s.tratarResposta("L1", "sim", "inst", "55219")).toBe(true);
    expect(j.updates).toHaveLength(0);
  });

  it("planilha já repartida: SIM fica com o mesmo corretor, que recebe o aviso", async () => {
    const { s, updates, enviados } = montar({ ...base, responsavelId: "c1" }, ["c2", "c3"], 0);
    expect(await s.tratarResposta("L1", "quero saber", "inst", "55219")).toBe(true);
    expect(updates[0]).toEqual(expect.objectContaining({ transferidoPorId: "g1" }));
    expect(updates[0].responsavelId).toBeUndefined();
    expect(enviados[0]).toContain("especialista da Kayser");
  });

  it("NÃO tira o lead do Kayser", async () => {
    const { s, enviados } = montar({ ...base });
    expect(await s.tratarResposta("L1", "não tenho interesse", "inst", "55219")).toBe(true);
    expect(enviados[0]).toContain("Não vamos mais te enviar");
  });

  it("1º contato varia, usa o nome e oferece sair", () => {
    const a = mensagemPrimeiroContato("maria silva", "Ilhamar", 0);
    expect(a).not.toBe(mensagemPrimeiroContato("maria silva", "Ilhamar", 1));
    expect(a).toContain("Maria");
    expect(a).toContain("responder NÃO");
  });
});

describe("Reengajamento — só cita empreendimento cadastrado", () => {
  const { acharPorNome } = require("./ia-one.util");
  const imoveis = ["Ilha stay home Resort", "Villa Santé", "Sky Mário Guimarães"];
  it("resposta de formulário não vira nome de empreendimento", () => {
    expect(acharPorNome(imoveis, "Agende sua visita!", (x: string) => x)).toBeUndefined();
    expect(acharPorNome(imoveis, "Ilha Stay", (x: string) => x)).toBe("Ilha stay home Resort");
  });
});
