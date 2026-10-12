import { LeadStatus } from "./lead.entity";
import { semContatoWhere, zeraContagemNaEtapa } from "./followup-regras";

describe("Follow-up por etapa (regra 13/10)", () => {
  it("zera a contagem ao entrar em agendamento, visita realizada e venda ganha", () => {
    expect(zeraContagemNaEtapa(LeadStatus.AGENDAMENTO)).toBe(true);
    expect(zeraContagemNaEtapa(LeadStatus.VISITA_REALIZADA)).toBe(true);
    expect(zeraContagemNaEtapa(LeadStatus.VENDA_GANHA)).toBe(true);
    expect(zeraContagemNaEtapa(LeadStatus.EM_ATENDIMENTO)).toBe(false);
  });

  it("limite: padrão nas outras etapas, 7 dias no agendamento, 15 depois da visita, venda nunca", () => {
    const agora = new Date("2026-10-13T12:00:00Z");
    const dias = (d: Date) => Math.round((agora.getTime() - d.getTime()) / 86400000);
    const [padrao, sete, quinze] = semContatoWhere({ naoPerturbe: false }, 3, agora) as any[];
    expect(dias(padrao.lastContactAt.value)).toBe(3);
    expect(padrao.status.value).toEqual(expect.arrayContaining([LeadStatus.VENDA_GANHA, LeadStatus.AGENDAMENTO, LeadStatus.VISITA_REALIZADA]));
    expect(dias(sete.lastContactAt.value)).toBe(7);
    expect(sete.status.value).toEqual([LeadStatus.AGENDAMENTO, LeadStatus.VISITA_AGENDADA]);
    expect(dias(quinze.lastContactAt.value)).toBe(15);
    expect(quinze.status.value).toContain(LeadStatus.VISITA_REALIZADA);
    expect(quinze.status.value).not.toContain(LeadStatus.VENDA_GANHA);
    expect(padrao.naoPerturbe).toBe(false);
  });
});
