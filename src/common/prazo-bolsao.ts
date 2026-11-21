/**
 * Prazo de cada etapa do lead SWAT antes de cair no Bolsão (Rodrigo 20/11), em horas,
 * contado de quando o lead ENTROU na etapa. Etapa fora da lista = sem relógio.
 */
export const PRAZO_BOLSAO_HORAS: Record<string, number> = {
  novo_lead: 48,
  primeiro_contato: 48,
  em_atendimento: 72,
  agendamento: 7 * 24,
  visita_agendada: 7 * 24,
  visita_realizada: 15 * 24,
  subida_pasta: 30 * 24,
  documentacao: 18 * 24,
  aprovacao: 30 * 24,
  reprovacao: 30 * 24,
};

/** Quando o lead SWAT cai no Bolsão (null = etapa sem relógio). */
export function prazoBolsao(status: string, entrouNaEtapa: Date | string | null | undefined): Date | null {
  const h = PRAZO_BOLSAO_HORAS[status];
  if (!h || !entrouNaEtapa) return null;
  return new Date(new Date(entrouNaEtapa).getTime() + h * 3_600_000);
}
