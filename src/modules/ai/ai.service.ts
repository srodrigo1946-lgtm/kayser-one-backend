import { Injectable, BadRequestException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Anthropic from "@anthropic-ai/sdk";
import axios from "axios";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Lead } from "../leads/lead.entity";
import { SettingsService } from "../settings/settings.service";
import { KnowledgeService } from "../knowledge/knowledge.service";
import { AiProvider } from "../settings/settings.entity";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const DEFAULT_MASTER_PROMPT = `Você é a Kayser One AI.
Sua função é atuar como consultora comercial inteligente para o mercado imobiliário.
Sempre seja educada, objetiva e profissional.
Nunca invente informações. Utilize apenas os dados presentes na Base de Conhecimento fornecida.

Ao iniciar uma conversa:
- Cumprimente conforme o horário do dia
- Identifique o nome do cliente
- Descubra o empreendimento de interesse
- Descubra a renda familiar
- Pergunte sobre FGTS
- Pergunte sobre a entrada disponível
- Descubra a cidade
- Classifique o lead (quente/morno/frio)

Se o cliente demonstrar interesse:
- Ofereça agendamento de visita
- Informe o corretor responsável
- Registre as informações relevantes

Se o cliente ficar dias sem resposta:
- Envie mensagem de follow-up adaptando a saudação ao horário

Nunca faça perguntas que já foram respondidas.
Se houver dúvida fora da base de conhecimento, encaminhe para um corretor humano.`;

const DEFAULT_MODELS: Record<AiProvider, string> = {
  [AiProvider.ANTHROPIC]: "claude-sonnet-4-6",
  [AiProvider.OPENAI]: "gpt-4o-mini",
  [AiProvider.GEMINI]: "gemini-1.5-flash",
};

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly settingsService: SettingsService,
    private readonly knowledgeService: KnowledgeService,
    @InjectRepository(Lead)
    private readonly leadsRepo: Repository<Lead>
  ) {}

  /** Monta o prompt de sistema a partir das configurações + conhecimento relevante (RAG). */
  private async buildSystemPrompt(query = ""): Promise<string> {
    const settings = await this.settingsService.get();
    const base = settings.masterPrompt?.trim() || DEFAULT_MASTER_PROMPT;
    const context = await this.knowledgeService.retrieve(query);
    if (!context) return base;
    return `${base}\n\n=== BASE DE CONHECIMENTO (use apenas estas informações) ===\n${context}`;
  }

  /** Resolve provedor, chave e modelo: usa override, depois settings, depois env. */
  private async resolveConfig(apiKeyOverride?: string) {
    const settings = await this.settingsService.get();
    const provider = settings.aiProvider || AiProvider.ANTHROPIC;
    const model = settings.aiModel || DEFAULT_MODELS[provider];

    const envKeyName: Record<AiProvider, string> = {
      [AiProvider.ANTHROPIC]: "ANTHROPIC_API_KEY",
      [AiProvider.OPENAI]: "OPENAI_API_KEY",
      [AiProvider.GEMINI]: "GOOGLE_AI_API_KEY",
    };
    const apiKey = apiKeyOverride || settings.aiApiKey || this.config.get(envKeyName[provider]);

    if (!apiKey) {
      throw new BadRequestException(
        `API Key da IA (${provider}) não configurada. Configure em Configurações.`
      );
    }
    return { provider, model, apiKey };
  }

  async chat(messages: ChatMessage[], apiKeyOverride?: string) {
    const { provider, model, apiKey } = await this.resolveConfig(apiKeyOverride);
    // Usa a última mensagem do usuário como consulta para o RAG.
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const system = await this.buildSystemPrompt(lastUser?.content || "");

    switch (provider) {
      case AiProvider.ANTHROPIC:
        return this.chatAnthropic(apiKey, model, system, messages);
      case AiProvider.OPENAI:
        return this.chatOpenAI(apiKey, model, system, messages);
      case AiProvider.GEMINI:
        return this.chatGemini(apiKey, model, system, messages);
      default:
        throw new BadRequestException("Provedor de IA inválido.");
    }
  }

  private async chatAnthropic(apiKey: string, model: string, system: string, messages: ChatMessage[]) {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({ model, max_tokens: 1024, system, messages });
    return { content: (response.content[0] as any).text as string, usage: response.usage };
  }

  private async chatOpenAI(apiKey: string, model: string, system: string, messages: ChatMessage[]) {
    const { data } = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      { model, max_tokens: 1024, messages: [{ role: "system", content: system }, ...messages] },
      { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" } }
    );
    return { content: data.choices?.[0]?.message?.content as string, usage: data.usage };
  }

  private async chatGemini(apiKey: string, model: string, system: string, messages: ChatMessage[]) {
    const contents = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
    const { data } = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      { systemInstruction: { parts: [{ text: system }] }, contents },
      { headers: { "Content-Type": "application/json" } }
    );
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text as string;
    return { content, usage: data.usageMetadata };
  }

  /** Gera apenas o texto de resposta (usado pelo fluxo automático de WhatsApp). */
  async generateReply(messages: ChatMessage[]): Promise<string> {
    const { content } = await this.chat(messages);
    return content;
  }

  async qualifyLead(leadId: string, conversation: string, apiKeyOverride?: string) {
    const lead = await this.leadsRepo.findOneOrFail({ where: { id: leadId } });
    const { provider, model, apiKey } = await this.resolveConfig(apiKeyOverride);

    const system = `Analise a conversa abaixo e retorne um JSON com:
- score: número de 0 a 100 (interesse do cliente)
- interesse: "alto" | "medio" | "baixo"
- renda_detectada: número ou null
- fgts_detectado: número ou null
- cidade_detectada: string ou null
- proximo_passo: string (ação recomendada)
Retorne APENAS o JSON, sem texto adicional.`;

    const userMsg: ChatMessage = {
      role: "user",
      content: `Conversa:\n${conversation}\n\nDados atuais do lead:\n${JSON.stringify({ name: lead.name, status: lead.status })}`,
    };

    let raw: string;
    try {
      if (provider === AiProvider.ANTHROPIC) {
        raw = (await this.chatAnthropic(apiKey, model, system, [userMsg])).content;
      } else if (provider === AiProvider.OPENAI) {
        raw = (await this.chatOpenAI(apiKey, model, system, [userMsg])).content;
      } else {
        raw = (await this.chatGemini(apiKey, model, system, [userMsg])).content;
      }
    } catch (err) {
      this.logger.error("Erro ao qualificar lead", err as any);
      return { score: null, error: "Falha ao chamar a IA." };
    }

    try {
      const cleaned = raw.replace(/```json|```/g, "").trim();
      const data = JSON.parse(cleaned);
      if (data.score) {
        lead.score = data.score;
        if (data.renda_detectada) lead.renda = data.renda_detectada;
        if (data.fgts_detectado) lead.fgts = data.fgts_detectado;
        if (data.cidade_detectada) lead.cidade = data.cidade_detectada;
        await this.leadsRepo.save(lead);
      }
      return data;
    } catch {
      return { score: null, error: "Não foi possível qualificar automaticamente." };
    }
  }
}
