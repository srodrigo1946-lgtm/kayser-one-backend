import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import * as XLSX from "xlsx";
import AdmZip from "adm-zip";
import { KnowledgeItem, KnowledgeType } from "./knowledge.entity";
import { KnowledgeChunk } from "./knowledge-chunk.entity";
import { EmbeddingService } from "./embedding.service";
import { StorageService } from "../storage/storage.service";
import { SettingsService } from "../settings/settings.service";
import { AiProvider } from "../settings/settings.entity";
import { Property } from "../properties/property.entity";
import { Lead } from "../leads/lead.entity";
import { LeadHistory, LeadHistoryType } from "../lead-history/lead-history.entity";

/** minúsculo, sem acento, só letras/números/espaço — pra comparar nomes. */
export function normalizarNome(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Palavras soltas que NÃO identificam um empreendimento sozinhas.
const GENERICAS = new Set(["residencial", "residence", "resort", "recreio", "barra", "porto", "beach", "home", "ilha", "villa", "vila", "sky", "oferta", "condominio", "edificio", "torre"]);

/**
 * Qual empreendimento o cliente citou no texto? Casa pelo nome inteiro, pelas duas
 * primeiras palavras ("ilha stay") ou pela 1ª palavra quando ela é marcante
 * ("oceanside", "renascenca", "ilhamar"). Vence o trecho mais longo. Null = nenhum.
 */
export function detectarEmpreendimento<T extends { name: string }>(texto: string, props: T[]): T | null {
  const t = ` ${normalizarNome(texto)} `;
  let melhor: { p: T; tam: number } | null = null;
  for (const p of props) {
    const nome = normalizarNome(p.name);
    const palavras = nome.split(" ").filter(Boolean);
    const frases = [nome, palavras.slice(0, 2).join(" ")];
    if (palavras[0] && (palavras[0].length >= 5 || palavras[0] === "beon") && !GENERICAS.has(palavras[0])) {
      frases.push(palavras[0]);
    }
    for (const f of frases) {
      if (f && f.length >= 4 && t.includes(` ${f} `) && (!melhor || f.length > melhor.tam)) {
        melhor = { p, tam: f.length };
      }
    }
  }
  return melhor?.p ?? null;
}
import Anthropic from "@anthropic-ai/sdk";

const IMAGEM_MIME: Record<string, "image/jpeg" | "image/png" | "image/webp" | "image/gif"> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

// Limite de caracteres por documento para manter a indexação gerenciável.
const MAX_CONTENT = 50000;
const CHUNK_SIZE = 1000;
const TOP_K = 6;

@Injectable()
export class KnowledgeService {
  constructor(
    @InjectRepository(KnowledgeItem)
    private readonly repo: Repository<KnowledgeItem>,
    @InjectRepository(KnowledgeChunk)
    private readonly chunkRepo: Repository<KnowledgeChunk>,
    private readonly embeddings: EmbeddingService,
    private readonly storage: StorageService,
    private readonly settings: SettingsService
  ) {}

  /**
   * Imagem (tabela de preços, folder, planta, print) → texto, lido pela IA (Claude
   * com visão). Usa a chave Anthropic da empresa (Configurações) ou a do servidor.
   */
  private async lerImagem(buffer: Buffer, mediaType: (typeof IMAGEM_MIME)[string]): Promise<string> {
    if (buffer.length > 5 * 1024 * 1024) {
      throw new BadRequestException("Imagem muito grande (máx. 5 MB). Reduza e envie de novo.");
    }
    const s = await this.settings.get();
    const empresaAnthropic = !s.aiProvider || s.aiProvider === AiProvider.ANTHROPIC;
    const apiKey = (empresaAnthropic && s.aiApiKey) || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new BadRequestException("Para ler imagens, configure a chave da IA (Anthropic) na página IA Agente.");
    }
    const model = (empresaAnthropic && s.aiModel) || "claude-sonnet-5";
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: buffer.toString("base64") } },
            {
              type: "text",
              text:
                "Esta imagem vai para a base de conhecimento de um assistente de vendas de imóveis. " +
                "Transcreva TODO o texto e números visíveis (preços, metragens, plantas, condições, endereços, datas), " +
                "organizando tabelas linha a linha. Depois, em 2-3 linhas, descreva o que a imagem mostra. " +
                "Não invente nada que não esteja na imagem. Responda em português.",
            },
          ],
        },
      ],
    });
    return resp.content.map((c: any) => (c.type === "text" ? c.text : "")).join("\n").trim();
  }

  /** Extrai o texto de um arquivo e salva como item (indexado) da base. */
  async extractAndStore(
    file: Express.Multer.File,
    opts: { title?: string; type?: KnowledgeType; propertyId?: string } = {}
  ) {
    if (!file) throw new BadRequestException("Nenhum arquivo enviado.");
    const name = file.originalname || "documento";
    const ext = name.split(".").pop()?.toLowerCase() || "";

    let text = "";
    try {
      if (ext === "pdf") {
        const pdfParse = require("pdf-parse");
        text = (await pdfParse(file.buffer)).text;
      } else if (ext === "docx" || ext === "doc") {
        const mammoth = require("mammoth");
        text = (await mammoth.extractRawText({ buffer: file.buffer })).value;
      } else if (ext === "pptx") {
        text = this.extractPptx(file.buffer);
      } else if (ext === "xlsx" || ext === "xls" || ext === "csv") {
        const wb = XLSX.read(file.buffer, { type: "buffer" });
        text = wb.SheetNames.map((sheet) => {
          const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheet]);
          return `# ${sheet}\n${csv}`;
        }).join("\n\n");
      } else if (ext === "txt" || ext === "md") {
        text = file.buffer.toString("utf-8");
      } else if (IMAGEM_MIME[ext]) {
        text = await this.lerImagem(file.buffer, IMAGEM_MIME[ext]);
      } else {
        throw new BadRequestException(
          `Formato .${ext} não suportado. Use PDF, imagem (JPG/PNG/WEBP), DOCX, PPTX, XLSX, CSV ou TXT.`
        );
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(`Falha ao extrair o conteúdo do arquivo: ${(err as Error).message}`);
    }

    text = (text || "").trim().slice(0, MAX_CONTENT);
    if (!text) throw new BadRequestException("Não foi possível extrair texto do arquivo.");

    // Guarda o arquivo original no MinIO/R2 (opcional). IMAGEM sem storage fica como
    // data URI — o Kayser precisa do arquivo pra ENVIAR a foto pro cliente.
    let fileKey: string | undefined;
    if (this.storage.isEnabled) {
      const key = `knowledge/${Date.now()}-${name}`;
      fileKey = (await this.storage.upload(key, file.buffer, file.mimetype)) || undefined;
    }
    if (!fileKey && IMAGEM_MIME[ext]) {
      fileKey = `data:${IMAGEM_MIME[ext]};base64,${file.buffer.toString("base64")}`;
    }

    // Empreendimento: o nome entra no título (a busca do Kayser acha pelo nome).
    let propertyId: string | undefined;
    let titulo = opts.title || name;
    if (opts.propertyId) {
      const p = await this.repo.manager.getRepository(Property).findOne({ where: { id: opts.propertyId } });
      if (p) {
        propertyId = p.id;
        titulo = `${p.name} — ${titulo}`;
      }
    }

    return this.create({
      title: titulo,
      content: text,
      type: opts.type || KnowledgeType.OUTRO,
      fileKey,
      propertyId,
    });
  }

  /** Extrai texto de um PPTX lendo os XML dos slides. */
  private extractPptx(buffer: Buffer): string {
    const zip = new AdmZip(buffer);
    const slides = zip
      .getEntries()
      .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
      .sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true }));
    return slides
      .map((s) => {
        const xml = s.getData().toString("utf-8");
        const matches = xml.match(/<a:t>([^<]*)<\/a:t>/g) || [];
        return matches.map((m) => m.replace(/<\/?a:t>/g, "")).join(" ");
      })
      .join("\n\n");
  }

  async findAll() {
    const items = await this.repo.find({ order: { updatedAt: "DESC" } });
    // Imagem guardada como data URI é pesada: a lista só diz que é imagem.
    return items.map((i) => (i.fileKey?.startsWith("data:") ? { ...i, fileKey: "imagem" } : i));
  }

  /**
   * Cliente citou um empreendimento na mensagem → o lead fica REGISTRADO nele
   * (empreendimento + vínculo com o imóvel) e o histórico anota. Só grava se o lead
   * ainda não está vinculado a um imóvel — o primeiro interesse (ou o corretor) vale.
   */
  async registrarInteresse(leadId: string, texto: string): Promise<string | null> {
    if (!leadId || !texto?.trim()) return null;
    const props = await this.repo.manager.getRepository(Property).find({ where: { active: true } });
    const p = detectarEmpreendimento(texto, props);
    if (!p) return null;
    const leads = this.repo.manager.getRepository(Lead);
    const lead = await leads.findOne({ where: { id: leadId } });
    if (!lead || lead.propertyId) return null;
    await leads.update(leadId, { propertyId: p.id, empreendimento: p.name });
    await this.repo.manager
      .getRepository(LeadHistory)
      .save({
        leadId,
        type: LeadHistoryType.SISTEMA,
        description: `Cliente perguntou sobre ${p.name} — lead registrado nesse empreendimento.`,
      } as any)
      .catch(() => {});
    return p.name;
  }

  /** Empreendimentos ativos com o resumo do cadastro (preço, área, entrega, stand...). */
  async catalogoEmpreendimentos(): Promise<string> {
    const props = await this.repo.manager.getRepository(Property).find({ where: { active: true }, order: { name: "ASC" } });
    const moeda = (v?: number) => (v ? `R$ ${Number(v).toLocaleString("pt-BR")}` : "");
    return props
      .map((p) => {
        const partes = [
          p.type,
          [p.bairro, p.cidade].filter(Boolean).join(", "),
          p.priceMin || p.priceMax ? `preço ${[moeda(p.priceMin), moeda(p.priceMax)].filter(Boolean).join(" a ")}` : "",
          p.areaMin || p.areaMax ? `área ${[p.areaMin, p.areaMax].filter(Boolean).join(" a ")} m²` : "",
          p.bedrooms ? `${p.bedrooms} quarto(s)` : "",
          p.parkingSpots ? `${p.parkingSpots} vaga(s)` : "",
          p.deliveryDate ? `entrega ${p.deliveryDate}` : "",
          p.standAddress ? `stand: ${p.standAddress}` : p.address ? `endereço: ${p.address}` : "",
          p.amenities?.length ? `lazer: ${p.amenities.slice(0, 8).join(", ")}` : "",
          p.description ? p.description.replace(/\s+/g, " ").slice(0, 300) : "",
        ].filter(Boolean);
        return `- ${p.name}: ${partes.join(" · ")}`;
      })
      .join("\n");
  }

  /**
   * Fotos de um empreendimento pra ENVIAR no WhatsApp: as do cadastro (Imóveis) +
   * as imagens subidas no Conhecimento do Kayser. Acha pelo nome (aproximado).
   */
  async fotosDoEmpreendimento(
    nome: string,
    max = 5
  ): Promise<{ nome: string; fotos: { base64: string; mimetype: string; fileName: string }[] } | null> {
    const alvo = nome.toLowerCase().trim();
    if (!alvo) return null;
    const props = await this.repo.manager.getRepository(Property).find({ where: { active: true } });
    const p =
      props.find((x) => (x.name || "").toLowerCase() === alvo) ||
      props.find((x) => alvo.includes((x.name || "").toLowerCase()) || (x.name || "").toLowerCase().includes(alvo));
    if (!p) return null;

    const fotos: { base64: string; mimetype: string; fileName: string }[] = [];
    const deDataUri = (uri: string, i: number) => {
      const m = /^data:([^;]+);base64,(.+)$/.exec(uri);
      if (m && m[1].startsWith("image/")) fotos.push({ mimetype: m[1], base64: m[2], fileName: `${p.name}-${i + 1}.jpg` });
    };
    // 1) Imagens subidas no Conhecimento do Kayser para este empreendimento.
    const itens = await this.repo.find({ where: { propertyId: p.id, active: true }, order: { createdAt: "ASC" } });
    for (const it of itens) {
      if (fotos.length >= max || !it.fileKey) continue;
      if (it.fileKey.startsWith("data:")) deDataUri(it.fileKey, fotos.length);
      else if (/\.(jpe?g|png|webp|gif)$/i.test(it.fileKey)) {
        const obj = await this.storage.getObject(it.fileKey);
        if (obj?.contentType.startsWith("image/")) {
          fotos.push({ base64: obj.buffer.toString("base64"), mimetype: obj.contentType, fileName: it.fileKey.split("/").pop() || "foto.jpg" });
        }
      }
    }
    // 2) Fotos do cadastro do imóvel.
    for (const ph of [...(p.photos ?? []), ...(p.imageUrl ? [p.imageUrl] : [])]) {
      if (fotos.length >= max) break;
      if (ph?.startsWith("data:")) deDataUri(ph, fotos.length);
    }
    return { nome: p.name, fotos };
  }

  async create(dto: Partial<KnowledgeItem>) {
    const item = await this.repo.save(this.repo.create(dto));
    await this.indexItem(item);
    return item;
  }

  async update(id: string, dto: Partial<KnowledgeItem>) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException("Item não encontrado.");
    const contentChanged = dto.content !== undefined && dto.content !== item.content;
    Object.assign(item, dto);
    const saved = await this.repo.save(item);
    if (contentChanged) await this.indexItem(saved);
    return saved;
  }

  async remove(id: string) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException("Item não encontrado.");
    await this.chunkRepo.delete({ knowledgeItemId: id });
    await this.repo.remove(item);
    return { message: "Item removido." };
  }

  /** Quebra o conteúdo em chunks, gera embeddings e regrava os chunks do item. */
  private async indexItem(item: KnowledgeItem) {
    await this.chunkRepo.delete({ knowledgeItemId: item.id });
    if (!item.active) return;

    // Cada pedaço leva o título (ex.: "Ilha Stay — tabela.pdf") — assim a busca acha
    // o trecho certo quando o cliente cita o empreendimento.
    const chunks = this.chunkText(item.content).map((c) => `[${item.title}]\n${c}`);
    for (const content of chunks) {
      const embedding = await this.embeddings.embed(content);
      await this.chunkRepo.save(this.chunkRepo.create({ knowledgeItemId: item.id, content, embedding }));
    }
  }

  private chunkText(text: string): string[] {
    const clean = text.replace(/\s+\n/g, "\n").trim();
    const chunks: string[] = [];
    for (let i = 0; i < clean.length; i += CHUNK_SIZE) {
      chunks.push(clean.slice(i, i + CHUNK_SIZE));
    }
    return chunks.slice(0, 100);
  }

  /**
   * Recupera os trechos mais relevantes para a consulta (RAG).
   * Usa similaridade do cosseno quando há embeddings; senão, pontuação por palavra-chave.
   */
  async retrieve(query: string, k = TOP_K): Promise<string> {
    const chunks = await this.chunkRepo.find();
    if (!chunks.length) return this.buildContext();

    const queryEmbedding = query ? await this.embeddings.embed(query) : null;

    let ranked: { content: string; score: number }[];
    if (queryEmbedding) {
      ranked = chunks
        .filter((c) => c.embedding)
        .map((c) => ({ content: c.content, score: EmbeddingService.cosine(queryEmbedding, c.embedding as number[]) }))
        .sort((a, b) => b.score - a.score);
    } else {
      const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
      ranked = chunks
        .map((c) => {
          const lc = c.content.toLowerCase();
          const score = terms.reduce((s, t) => s + (lc.includes(t) ? 1 : 0), 0);
          return { content: c.content, score };
        })
        .sort((a, b) => b.score - a.score);
    }

    const top = ranked.slice(0, k).filter((r) => r.score > 0);
    const chosen = top.length ? top : ranked.slice(0, k);
    return chosen.map((r) => r.content).join("\n\n---\n\n");
  }

  /** Bloco com todo o conhecimento ativo (fallback quando não há chunks). */
  async buildContext(): Promise<string> {
    const items = await this.repo.find({ where: { active: true }, order: { type: "ASC" } });
    if (!items.length) return "";
    return items.map((i) => `### ${i.title} (${i.type})\n${i.content}`).join("\n\n");
  }
}
