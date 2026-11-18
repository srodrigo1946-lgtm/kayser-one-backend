import axios from "axios";
import { comCodigoBrasil } from "./telefone";

/**
 * Quais números NÃO têm WhatsApp (Evolution /chat/whatsappNumbers, de 50 em 50).
 * Se a Evolution falhar, o número não entra na lista (na dúvida, deixa entrar).
 */
export async function numerosSemWhatsapp(apiUrl: string, apiKey: string, instancia: string, telefones: string[]): Promise<Set<string>> {
  const sem = new Set<string>();
  const unicos = [...new Set(telefones.map(comCodigoBrasil).filter((t) => t.length >= 10))];
  for (let i = 0; i < unicos.length; i += 50) {
    const lote = unicos.slice(i, i + 50);
    try {
      const { data } = await axios.post(
        `${apiUrl}/chat/whatsappNumbers/${instancia}`,
        { numbers: lote },
        { headers: { apikey: apiKey, "Content-Type": "application/json" }, timeout: 30_000 }
      );
      for (const r of Array.isArray(data) ? data : []) {
        if (r && r.exists === false) sem.add(comCodigoBrasil(String(r.number ?? "")));
      }
    } catch {
      /* Evolution fora: não bloqueia ninguém */
    }
  }
  return sem;
}
