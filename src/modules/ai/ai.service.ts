import { Injectable, BadRequestException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Anthropic from "@anthropic-ai/sdk";
import axios from "axios";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Lead } from "../leads/lead.entity";
import { User } from "../users/user.entity";
import { SettingsService } from "../settings/settings.service";
import { KnowledgeService } from "../knowledge/knowledge.service";
import { AiProvider } from "../settings/settings.entity";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Override de IA por usuário (cargo). Quando tem apiKey, sobrepõe a config da empresa. */
export interface UserAiConfig {
  provider?: string | null;
  model?: string | null;
  apiKey?: string | null;
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

/** Como a voz do Kayser deve soar (OpenAI gpt-4o-mini-tts). */
const INSTRUCAO_VOZ = `Idioma: português do Brasil, sotaque carioca natural. Você é um corretor de imóveis brasileiro, jovem e muito animado, gravando um áudio de WhatsApp para um cliente que acabou de chamar.
Energia: ALTA e contagiante — empolgado de verdade com o imóvel, sorrindo o tempo todo na voz. Soa como alguém que ama o que faz.
Entonação: bem expressiva e variada, subindo nas boas notícias ("olha que legal!"), com ênfase nas palavras importantes (preço, lazer, localização). Nada de voz reta.
Ritmo: dinâmico e fluido, um pouco acelerado como numa conversa animada, com micro pausas naturais entre as ideias.
Estilo: caloroso e próximo, como falar com um amigo — humano, espontâneo, com leve informalidade carioca.
Evite: voz robótica, monótona, cansada, tom de locutor de rádio ou de telemarketing.`;

const DEFAULT_MODELS: Record<AiProvider, string> = {
  [AiProvider.ANTHROPIC]: "claude-sonnet-5",
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
    private readonly leadsRepo: Repository<Lead>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>
  ) {}

  /** Config de IA de um usuário (para override), ou undefined se ele não tem chave própria. */
  async getUserAiConfig(userId?: string): Promise<UserAiConfig | undefined> {
    if (!userId) return undefined;
    // aiApiKey é select:false na entidade — addSelect para trazer a chave do usuário.
    const u = await this.usersRepo
      .createQueryBuilder("u")
      .addSelect("u.aiApiKey")
      .where("u.id = :id", { id: userId })
      .getOne();
    return this.userAiFrom(u);
  }

  /** Mapeia um usuário (ou o req.user) para override de IA; undefined se não tem chave própria. */
  userAiFrom(u?: { aiProvider?: string; aiModel?: string; aiApiKey?: string } | null): UserAiConfig | undefined {
    if (!u?.aiApiKey) return undefined;
    return { provider: u.aiProvider, model: u.aiModel, apiKey: u.aiApiKey };
  }

  /** Monta o prompt de sistema a partir das configurações + conhecimento relevante (RAG). */
  private async buildSystemPrompt(query = ""): Promise<string> {
    const settings = await this.settingsService.get();
    const base = settings.masterPrompt?.trim() || DEFAULT_MASTER_PROMPT;
    const context = await this.knowledgeService.retrieve(query);
    if (!context) return base;
    return `${base}\n\n=== BASE DE CONHECIMENTO (use apenas estas informações) ===\n${context}`;
  }

  /**
   * Resolve provedor, chave e modelo, nesta ordem:
   * 1) chave própria do usuário (cargo) → 2) chave da empresa (Settings) → 3) env.
   */
  private async resolveConfig(userAi?: UserAiConfig) {
    const settings = await this.settingsService.get();
    const envKeyName: Record<AiProvider, string> = {
      [AiProvider.ANTHROPIC]: "ANTHROPIC_API_KEY",
      [AiProvider.OPENAI]: "OPENAI_API_KEY",
      [AiProvider.GEMINI]: "GOOGLE_AI_API_KEY",
    };

    // 1) Chave própria do usuário tem prioridade (pode usar outro provedor).
    if (userAi?.apiKey) {
      const provider = (userAi.provider as AiProvider) || settings.aiProvider || AiProvider.ANTHROPIC;
      const model = userAi.model || DEFAULT_MODELS[provider];
      return { provider, model, apiKey: userAi.apiKey };
    }

    // 2) Chave da empresa (Settings) → 3) env.
    const provider = settings.aiProvider || AiProvider.ANTHROPIC;
    const model = settings.aiModel || DEFAULT_MODELS[provider];
    const apiKey = settings.aiApiKey || this.config.get(envKeyName[provider]);
    if (!apiKey) {
      throw new BadRequestException(
        `API Key da IA (${provider}) não configurada. Configure a sua na página IA Agente, ou peça ao Diretor a chave da empresa.`
      );
    }
    return { provider, model, apiKey };
  }

  async chat(messages: ChatMessage[], userAi?: UserAiConfig, extraSystem?: string) {
    const { provider, model, apiKey } = await this.resolveConfig(userAi);
    // Usa a última mensagem do usuário como consulta para o RAG.
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const base = await this.buildSystemPrompt(lastUser?.content || "");
    const system = extraSystem ? `${base}

${extraSystem}` : base;

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
    // Modelos novos (Sonnet 5, Opus 4.6+, Fable) pensam antes de responder: o 1º bloco
    // é "thinking" e o texto vem depois — ler só content[0] dava "(sem resposta)".
    // O raciocínio conta no max_tokens, então há folga; effort "low" = resposta rápida
    // (WhatsApp/qualificação não precisam de raciocínio longo).
    const modeloNovo = /claude-(sonnet-5|opus-(5|4-[678])|fable|mythos)/.test(model);
    const response = await client.messages.create({
      model,
      max_tokens: modeloNovo ? 4096 : 1024,
      system,
      messages,
      ...(modeloNovo ? { output_config: { effort: "low" } } : {}),
    } as any);
    const content = (response.content as any[])
      .filter((b) => b.type === "text")
      .map((b) => b.text as string)
      .join("")
      .trim();
    return { content, usage: response.usage };
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
  async generateReply(messages: ChatMessage[], userAi?: UserAiConfig, extraSystem?: string): Promise<string> {
    const { content } = await this.chat(messages, userAi, extraSystem);
    return content;
  }

  /**
   * Lê a conversa e diz se o cliente CONFIRMOU uma visita com dia e horário.
   * Devolve a data/hora no horário de Brasília ("YYYY-MM-DDTHH:mm") ou null.
   */
  async extrairVisita(
    conversation: string,
    userAi?: UserAiConfig
  ): Promise<{ confirmada: boolean; dataHora: string | null; local: string | null }> {
    const { provider, model, apiKey } = await this.resolveConfig(userAi);
    const hoje = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    const system = `Hoje é ${hoje} (horário de Brasília).
Analise a conversa e responda se o CLIENTE CONFIRMOU uma visita com DIA e HORÁRIO definidos.
Só conta como confirmada se o cliente aceitou/combinou um dia E um horário (não basta "quero visitar").
Retorne APENAS um JSON:
{"confirmada": true|false, "dataHora": "YYYY-MM-DDTHH:mm" (horário de Brasília) ou null, "local": "empreendimento/endereço citado" ou null}`;
    const userMsg: ChatMessage = { role: "user", content: `Conversa:
${conversation}` };
    let raw: string;
    if (provider === AiProvider.ANTHROPIC) raw = (await this.chatAnthropic(apiKey, model, system, [userMsg])).content;
    else if (provider === AiProvider.OPENAI) raw = (await this.chatOpenAI(apiKey, model, system, [userMsg])).content;
    else raw = (await this.chatGemini(apiKey, model, system, [userMsg])).content;
    try {
      const d = JSON.parse(raw.replace(/```json|```/g, "").trim());
      return { confirmada: !!d.confirmada && !!d.dataHora, dataHora: d.dataHora || null, local: d.local || null };
    } catch {
      return { confirmada: false, dataHora: null, local: null };
    }
  }

  /** Último erro da transcrição de áudio (mostrado no botão "Testar áudio"). */
  private ultimoErroAudio: string | null = null;

  /** Chaves que servem pra ouvir áudio (a Claude não ouve): OpenAI e/ou Google. */
  private async chavesAudio() {
    const s = await this.settingsService.get();
    return {
      // 1º a chave de áudio colada na página IA; depois a da empresa (se for OpenAI); depois o servidor.
      openaiKey:
        s.audioApiKey || (s.aiProvider === AiProvider.OPENAI && s.aiApiKey) || this.config.get<string>("OPENAI_API_KEY") || "",
      geminiKey: (s.aiProvider === AiProvider.GEMINI && s.aiApiKey) || this.config.get<string>("GOOGLE_AI_API_KEY") || "",
    };
  }

  /** Modelos do Google a tentar, em ordem (o nome muda com o tempo). */
  private modelosGemini(): string[] {
    const env = this.config.get<string>("GEMINI_AUDIO_MODEL");
    return [...new Set([env, "gemini-2.5-flash", "gemini-flash-latest", "gemini-2.0-flash", "gemini-1.5-flash"].filter(Boolean) as string[])];
  }

  /**
   * Transcreve o ÁUDIO (mensagem de voz) do cliente. A Claude não ouve áudio, então usa
   * OpenAI (Whisper) se houver chave, senão Google (Gemini) — tentando vários modelos.
   * Null se não conseguir (o motivo fica em ultimoErroAudio e no log).
   */
  async transcreverAudio(base64: string, mime: string): Promise<string | null> {
    const { openaiKey, geminiKey } = await this.chavesAudio();
    const tipo = (mime || "audio/ogg").split(";")[0].trim() || "audio/ogg";
    const erros: string[] = [];
    if (!openaiKey && !geminiKey) {
      this.ultimoErroAudio = "Nenhuma chave de áudio no servidor (GOOGLE_AI_API_KEY ou OPENAI_API_KEY).";
      this.logger.warn(this.ultimoErroAudio);
      return null;
    }
    if (openaiKey) {
      try {
        const form = new FormData();
        const ext = tipo.includes("mpeg") ? "mp3" : tipo.includes("mp4") ? "m4a" : "ogg";
        form.append("file", new Blob([Buffer.from(base64, "base64")], { type: tipo }), `audio.${ext}`);
        form.append("model", "whisper-1");
        form.append("language", "pt");
        const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${openaiKey}` },
          body: form,
        });
        if (r.ok) {
          const t = ((await r.json()) as any)?.text?.trim();
          if (t) {
            this.ultimoErroAudio = null;
            return t;
          }
          erros.push("OpenAI: transcrição vazia");
        } else {
          erros.push(`OpenAI ${r.status}: ${(await r.text()).slice(0, 160)}`);
        }
      } catch (err) {
        erros.push(`OpenAI: ${(err as Error).message}`);
      }
    }
    if (geminiKey) {
      for (const model of this.modelosGemini()) {
        try {
          const { data } = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
            {
              contents: [
                {
                  role: "user",
                  parts: [
                    { inline_data: { mime_type: tipo, data: base64 } },
                    { text: "Transcreva fielmente este áudio em português do Brasil. Responda SÓ com a transcrição." },
                  ],
                },
              ],
            },
            { headers: { "Content-Type": "application/json" }, timeout: 60_000 }
          );
          const t = (data?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text || "").join(" ").trim();
          if (t) {
            this.ultimoErroAudio = null;
            return t;
          }
          erros.push(`Google ${model}: transcrição vazia`);
        } catch (err: any) {
          const st = err?.response?.status;
          const msg = err?.response?.data?.error?.message || err?.message || "erro";
          erros.push(`Google ${model} ${st ?? ""}: ${String(msg).slice(0, 160)}`);
          // 400/401/403 = chave/áudio com problema: outro modelo não resolve.
          if (st === 400 || st === 401 || st === 403) break;
        }
      }
    }
    this.ultimoErroAudio = erros.join(" | ") || "Falha desconhecida";
    this.logger.warn(`Falha ao transcrever áudio: ${this.ultimoErroAudio}`);
    return null;
  }

  /**
   * Texto → VOZ (resposta do Kayser em áudio quando o cliente mandou áudio). OpenAI TTS,
   * voz MASCULINA ("onyx", escolha do Rodrigo), em ogg/opus = mensagem de voz do WhatsApp.
   * Null se não houver chave OpenAI ou falhar (aí a resposta vai em texto).
   */
  async falarTexto(texto: string): Promise<{ base64: string; mimetype: string } | null> {
    const { openaiKey } = await this.chavesAudio();
    if (!openaiKey) return null;
    // Voz não lê emoji nem *negrito*: limpa e corta (áudio longo cansa).
    const fala = texto
      .replace(/[*_~`]/g, "")
      .replace(/\p{Extended_Pictographic}/gu, "")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 900);
    if (!fala) return null;
    const tentativas: Record<string, unknown>[] = [
      // Voz masculina mais natural primeiro ("ash"); "onyx" de reserva. Instrução pra soar
      // como gente de verdade no WhatsApp, não locutor (pedido do Rodrigo: bem humanizado).
      { model: "gpt-4o-mini-tts", voice: "ash", instructions: INSTRUCAO_VOZ },
      { model: "gpt-4o-mini-tts", voice: "onyx", instructions: INSTRUCAO_VOZ },
      { model: "tts-1", voice: "onyx" },
    ];
    for (const t of tentativas) {
      try {
        const r = await fetch("https://api.openai.com/v1/audio/speech", {
          method: "POST",
          headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ ...t, input: fala, response_format: "opus" }),
        });
        if (r.ok) {
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.length) return { base64: buf.toString("base64"), mimetype: "audio/ogg; codecs=opus" };
        } else {
          this.logger.warn(`TTS ${t.model} falhou (${r.status}): ${(await r.text()).slice(0, 160)}`);
        }
      } catch (err) {
        this.logger.warn(`TTS ${t.model} erro: ${(err as Error).message}`);
      }
    }
    return null;
  }

  /**
   * Diagnóstico do áudio (botão "Testar áudio", só Diretor): quais chaves existem
   * (sem mostrar a chave), se o Google/OpenAI respondem e o último erro.
   */
  async diagnosticoAudio() {
    const { openaiKey, geminiKey } = await this.chavesAudio();
    const testes: { provedor: string; ok: boolean; detalhe: string }[] = [];
    if (openaiKey) {
      try {
        const r = await fetch("https://api.openai.com/v1/models/whisper-1", { headers: { Authorization: `Bearer ${openaiKey}` } });
        testes.push({ provedor: "OpenAI (Whisper)", ok: r.ok, detalhe: r.ok ? "chave válida" : `erro ${r.status}` });
      } catch (err) {
        testes.push({ provedor: "OpenAI (Whisper)", ok: false, detalhe: (err as Error).message });
      }
    }
    if (geminiKey) {
      try {
        const { data } = await axios.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}&pageSize=200`, { timeout: 20_000 });
        const disponiveis = ((data?.models ?? []) as any[]).map((m) => String(m.name || "").replace("models/", ""));
        const usavel = this.modelosGemini().find((m) => disponiveis.includes(m));
        testes.push({
          provedor: "Google (Gemini)",
          ok: !!usavel,
          detalhe: usavel ? `chave válida — vai usar ${usavel}` : `chave válida, mas nenhum modelo da lista existe (tem: ${disponiveis.filter((m) => m.includes("flash")).slice(0, 5).join(", ")})`,
        });
      } catch (err: any) {
        testes.push({ provedor: "Google (Gemini)", ok: false, detalhe: `erro ${err?.response?.status ?? ""} ${err?.response?.data?.error?.message ?? err?.message ?? ""}`.trim() });
      }
    }
    return {
      temChaveOpenAI: !!openaiKey,
      temChaveGoogle: !!geminiKey,
      testes,
      ultimoErro: this.ultimoErroAudio,
    };
  }

  /**
   * Qual empreendimento este ANÚNCIO divulga? Recebe o título/texto do anúncio e a lista
   * (nome + bairro/cidade). Usa conhecimento de região (ex.: "Grande Tijuca" inclui Andaraí).
   * Devolve o nome exato da lista ou null se não der pra saber.
   */
  async escolherEmpreendimento(anuncio: string, opcoes: string): Promise<string | null> {
    const { provider, model, apiKey } = await this.resolveConfig();
    const system = `Você identifica qual empreendimento imobiliário um anúncio de Facebook/Instagram está divulgando.
Use o nome, o bairro e a região (ex.: "Grande Tijuca" inclui Tijuca, Andaraí, Vila Isabel, Grajaú, Maracanã; "Barra Olímpica" fica na Barra/Jacarepaguá).
Responda APENAS um JSON: {"empreendimento": "nome EXATO da lista" } ou {"empreendimento": null} se não der pra saber com segurança.`;
    const userMsg: ChatMessage = { role: "user", content: `Anúncio: ${anuncio}\n\nEmpreendimentos:\n${opcoes}` };
    let raw: string;
    if (provider === AiProvider.ANTHROPIC) raw = (await this.chatAnthropic(apiKey, model, system, [userMsg])).content;
    else if (provider === AiProvider.OPENAI) raw = (await this.chatOpenAI(apiKey, model, system, [userMsg])).content;
    else raw = (await this.chatGemini(apiKey, model, system, [userMsg])).content;
    try {
      const d = JSON.parse(raw.replace(/```json|```/g, "").trim());
      return typeof d.empreendimento === "string" && d.empreendimento.trim() ? d.empreendimento.trim() : null;
    } catch {
      return null;
    }
  }

  async qualifyLead(leadId: string, conversation: string, userAi?: UserAiConfig) {
    const lead = await this.leadsRepo.findOneOrFail({ where: { id: leadId } });
    const { provider, model, apiKey } = await this.resolveConfig(userAi);

    const system = `Analise a conversa abaixo e retorne um JSON com:
- score: número de 0 a 100 (interesse do cliente)
- interesse: "alto" | "medio" | "baixo"
- renda_detectada: número ou null
- fgts_detectado: número ou null
- cidade_detectada: string ou null
- nome_detectado: string ou null (nome que o CLIENTE disse ser o dele; null se não disse — NÃO use nome de corretor/empresa)
- email_detectado: string ou null (e-mail que o cliente informou)
- empreendimento_detectado: string ou null (nome do imóvel/empreendimento que o cliente citou; null se ele não citou nenhum — NÃO invente)
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
        // E-mail: só completa o vazio.
        if (data.email_detectado && !lead.email && /@/.test(data.email_detectado)) {
          lead.email = String(data.email_detectado).trim().toLowerCase();
        }
        // Nome: troca só o "nome provisório" (número de telefone ou "Contato WhatsApp").
        const provisorio = !lead.name || /^[\d\s()+-]+$/.test(lead.name) || lead.name === "Contato WhatsApp";
        if (data.nome_detectado && provisorio && String(data.nome_detectado).trim().length >= 2) {
          lead.name = String(data.nome_detectado).trim().slice(0, 80);
        }
        // Só completa o que está vazio: o que o corretor (ou o anúncio) já
        // preencheu vale mais que o palpite da IA.
        if (data.empreendimento_detectado && !lead.empreendimento) {
          lead.empreendimento = data.empreendimento_detectado;
        }
        await this.leadsRepo.save(lead);
      }
      return data;
    } catch {
      return { score: null, error: "Não foi possível qualificar automaticamente." };
    }
  }
}
