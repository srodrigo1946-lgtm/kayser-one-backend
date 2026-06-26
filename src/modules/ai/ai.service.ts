import { Injectable, BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Anthropic from "@anthropic-ai/sdk";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Lead } from "../leads/lead.entity";

const MASTER_PROMPT = `Você é a Kayser One AI.
Sua função é atuar como consultora comercial inteligente para o mercado imobiliário.
Sempre seja educada, objetiva e profissional.
Nunca invente informações. Utilize apenas os dados presentes na Base de Conhecimento fornecida.

Ao iniciar uma conversa:
- Cumprimente conforme horário do dia
- Identifique o nome do cliente
- Descubra o empreendimento de interesse
- Descubra renda familiar
- Pergunte sobre FGTS
- Pergunte sobre entrada disponível
- Descubra a cidade
- Classifique o lead (quente/morno/frio)

Se o cliente demonstrar interesse:
- Ofereça agendamento de visita
- Informe o corretor responsável
- Registre todas as informações no CRM

Se o cliente ficar 3 dias sem resposta:
- Envie mensagem de follow-up adaptando a saudação ao horário

Nunca faça perguntas que já foram respondidas.
Se houver dúvida fora da base de conhecimento, encaminhe para um corretor humano.`;

@Injectable()
export class AiService {
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(Lead)
    private readonly leadsRepo: Repository<Lead>
  ) {}

  async chat(messages: { role: "user" | "assistant"; content: string }[], apiKey?: string) {
    const key = apiKey || this.config.get("ANTHROPIC_API_KEY");
    if (!key) throw new BadRequestException("API Key da IA não configurada.");

    const client = new Anthropic({ apiKey: key });

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: MASTER_PROMPT,
      messages,
    });

    return {
      content: (response.content[0] as any).text,
      usage: response.usage,
    };
  }

  async qualifyLead(leadId: string, conversation: string, apiKey?: string) {
    const lead = await this.leadsRepo.findOneOrFail({ where: { id: leadId } });
    const key = apiKey || this.config.get("ANTHROPIC_API_KEY");
    if (!key) throw new BadRequestException("API Key da IA não configurada.");

    const client = new Anthropic({ apiKey: key });

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system: `Analise a conversa abaixo e retorne um JSON com:
- score: número de 0 a 100 (interesse do cliente)
- interesse: "alto" | "medio" | "baixo"
- renda_detectada: número ou null
- fgts_detectado: número ou null
- cidade_detectada: string ou null
- proximo_passo: string (ação recomendada)
Retorne APENAS o JSON, sem texto adicional.`,
      messages: [{ role: "user", content: `Conversa:\n${conversation}\n\nDados atuais do lead:\n${JSON.stringify({ name: lead.name, status: lead.status })}` }],
    });

    try {
      const data = JSON.parse((response.content[0] as any).text);
      // Update lead score
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
