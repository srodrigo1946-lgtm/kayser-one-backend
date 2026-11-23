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

/** Fila normal entra no Bolsão só pros leads distribuídos a partir daqui (regra nova de 23/11). */
export const FILA_NORMAL_DESDE = "2026-11-23T00:00:00-03:00";

/**
 * SLA de TODOS os leads de anúncio (Facebook/Meta e Google Ads) — Rodrigo 23/11 16:57:
 * o relógio começa a contar daqui (lead antigo não despenca de uma vez no Bolsão).
 */
export const SLA_ANUNCIO_DESDE = "2026-11-23T16:57:00-03:00";

/** Lead de anúncio (alias `l`): mesma regra da fila (Meta) + Google Ads/Vitrine da Tathy. */
export const LEAD_ANUNCIO_SQL = `(l.source::text IN ('anuncio','formulario_meta','whatsapp') OR l.origem = 'google_ads' OR l.campanha ILIKE 'Vitrine%')`;

export const ehLeadDeAnuncio = (l: { source?: any; origem?: string | null; campanha?: string | null }) =>
  ["anuncio", "formulario_meta", "whatsapp"].includes(String(l.source)) || l.origem === "google_ads" || /^vitrine/i.test(l.campanha || "");

/** Quando o lead cai no Bolsão (null = etapa sem relógio). */
export function prazoBolsao(status: string, entrouNaEtapa: Date | string | null | undefined): Date | null {
  const h = PRAZO_BOLSAO_HORAS[status];
  if (!h || !entrouNaEtapa) return null;
  return new Date(new Date(entrouNaEtapa).getTime() + h * 3_600_000);
}
