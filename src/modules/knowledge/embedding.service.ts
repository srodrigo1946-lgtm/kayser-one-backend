import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import { SettingsService } from "../settings/settings.service";
import { AiProvider } from "../settings/settings.entity";

/**
 * Gera embeddings de texto usando o provedor configurado.
 * Suporta OpenAI e Gemini (Anthropic não possui API de embeddings pública).
 * Quando não há provedor/chave compatível, retorna null e o RAG cai para busca por palavra-chave.
 */
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly settings: SettingsService
  ) {}

  private async resolve(): Promise<{ provider: AiProvider; apiKey: string } | null> {
    const s = await this.settings.get();
    // OpenAI
    const openaiKey =
      (s.aiProvider === AiProvider.OPENAI ? s.aiApiKey : null) ||
      this.config.get("OPENAI_API_KEY");
    if (openaiKey) return { provider: AiProvider.OPENAI, apiKey: openaiKey };

    // Gemini
    const geminiKey =
      (s.aiProvider === AiProvider.GEMINI ? s.aiApiKey : null) ||
      this.config.get("GOOGLE_AI_API_KEY");
    if (geminiKey) return { provider: AiProvider.GEMINI, apiKey: geminiKey };

    return null;
  }

  async embed(text: string): Promise<number[] | null> {
    const cfg = await this.resolve();
    if (!cfg) return null;
    const input = text.slice(0, 8000);
    try {
      if (cfg.provider === AiProvider.OPENAI) {
        const { data } = await axios.post(
          "https://api.openai.com/v1/embeddings",
          { model: "text-embedding-3-small", input },
          { headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" } }
        );
        return data.data?.[0]?.embedding ?? null;
      }
      // Gemini
      const { data } = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${cfg.apiKey}`,
        { content: { parts: [{ text: input }] } },
        { headers: { "Content-Type": "application/json" } }
      );
      return data.embedding?.values ?? null;
    } catch (err) {
      this.logger.warn(`Falha ao gerar embedding: ${(err as Error).message}`);
      return null;
    }
  }

  /** Similaridade do cosseno entre dois vetores. */
  static cosine(a: number[], b: number[]): number {
    let dot = 0;
    let na = 0;
    let nb = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }
}
