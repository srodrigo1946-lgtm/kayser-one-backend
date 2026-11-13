import { BadRequestException } from "@nestjs/common";
import { In, LessThan, Not } from "typeorm";
import { subDays } from "date-fns";
import { LeadStatus } from "./lead.entity";

/**
 * Follow-up da IA por etapa (regra do Rodrigo, 13/10/2026):
 * - visita sendo agendada → 7 dias sem contato;
 * - depois da visita realizada → 15 dias;
 * - venda ganha/perdida → nunca;
 * - demais etapas → o padrão das Configurações (3 dias).
 * Ao ENTRAR numa dessas etapas a contagem zera (lastContactAt = agora).
 */
export const FOLLOWUP_7_DIAS = [LeadStatus.AGENDAMENTO, LeadStatus.VISITA_AGENDADA];
export const FOLLOWUP_15_DIAS = [
  LeadStatus.VISITA_REALIZADA,
  LeadStatus.SIMULACAO,
  LeadStatus.SUBIDA_PASTA,
  LeadStatus.APROVACAO,
  LeadStatus.REPROVACAO,
];
export const SEM_FOLLOWUP = [LeadStatus.VENDA_GANHA, LeadStatus.VENDA_PERDIDA];

/** Entrar nesta etapa zera a contagem de dias sem contato? */
export function zeraContagemNaEtapa(status: string): boolean {
  return [...FOLLOWUP_7_DIAS, ...FOLLOWUP_15_DIAS, LeadStatus.VENDA_GANHA].includes(status as LeadStatus);
}

/**
 * "Sem interesse" (Rodrigo 13/11): quem marca à mão precisa escrever o motivo (mín. 5 letras).
 * Sistema (sem usuário) passa. Devolve o motivo limpo, ou null quando não está virando sem interesse.
 */
export function exigirMotivoPerda(de: string | undefined, para: string | undefined, motivo: string | undefined, user?: { id: string } | null): string | null {
  if (para !== LeadStatus.VENDA_PERDIDA || de === LeadStatus.VENDA_PERDIDA) return null;
  const m = String(motivo ?? "").trim().slice(0, 500);
  if (user && m.length < 5) throw new BadRequestException("Escreva o motivo do cliente estar sem interesse (mínimo 5 letras).");
  return m || null;
}

/** Filtro (TypeORM, "OU") dos leads sem contato há mais dias que o limite da etapa deles. */
export function semContatoWhere<T extends object>(base: T, diasPadrao: number, agora = new Date()) {
  return [
    { ...base, lastContactAt: LessThan(subDays(agora, diasPadrao)), status: Not(In([...SEM_FOLLOWUP, ...FOLLOWUP_7_DIAS, ...FOLLOWUP_15_DIAS])) },
    { ...base, lastContactAt: LessThan(subDays(agora, 7)), status: In(FOLLOWUP_7_DIAS) },
    { ...base, lastContactAt: LessThan(subDays(agora, 15)), status: In(FOLLOWUP_15_DIAS) },
  ];
}
