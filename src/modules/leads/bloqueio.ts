import { EntityManager } from "typeorm";

/**
 * Lead EXCLUÍDO pelo Diretor não volta: o telefone fica em `leads_bloqueados` e o
 * formulário do Meta (webhook/puxar) e o WhatsApp não criam lead de novo com ele.
 */

/** Telefone só com dígitos, com e sem o 55 do Brasil. */
export function variantesTelefone(...fones: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const f of fones) {
    const d = (f || "").replace(/\D/g, "");
    if (d.length < 8) continue;
    const sem55 = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
    out.add(sem55);
    out.add(`55${sem55}`);
  }
  return [...out];
}

export async function bloquearTelefones(m: EntityManager, ...fones: (string | null | undefined)[]) {
  for (const p of variantesTelefone(...fones)) {
    await m.query(`INSERT INTO leads_bloqueados (phone) VALUES ($1) ON CONFLICT (phone) DO NOTHING`, [p]);
  }
}

export async function telefoneBloqueado(m: EntityManager, ...fones: (string | null | undefined)[]): Promise<boolean> {
  const tels = variantesTelefone(...fones);
  if (!tels.length) return false;
  try {
    const r = await m.query(`SELECT 1 FROM leads_bloqueados WHERE phone = ANY($1) LIMIT 1`, [tels]);
    return r.length > 0;
  } catch {
    return false; // tabela ainda não existe (teste/sqlite): não bloqueia
  }
}
