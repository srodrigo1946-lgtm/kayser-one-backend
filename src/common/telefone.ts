/**
 * Celular/fixo do Brasil sem o código do país (DDD + número = 10 ou 11 dígitos) ganha o 55.
 * Sem ele o WhatsApp responde "número não existe" (bug achado em 01/11/2026: planilhas com
 * "21 9..." nunca recebiam mensagem). Outros tamanhos (grupos, internacionais) ficam como estão.
 */
export function comCodigoBrasil(telefone: string): string {
  const d = (telefone || "").replace(/\D/g, "");
  return d.length === 10 || d.length === 11 ? `55${d}` : d;
}

/** O mesmo número com e sem o 55, pra achar a conversa antiga em qualquer um dos formatos. */
export function variantesDoTelefone(telefone: string): string[] {
  const d = (telefone || "").replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) return [`55${d}`, d];
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) return [d, d.slice(2)];
  return [d];
}
