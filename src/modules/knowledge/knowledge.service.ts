import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import * as XLSX from "xlsx";
import AdmZip from "adm-zip";
import { KnowledgeItem, KnowledgeType } from "./knowledge.entity";
import { KnowledgeChunk } from "./knowledge-chunk.entity";
import { EmbeddingService } from "./embedding.service";
import { StorageService } from "../storage/storage.service";

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
    private readonly storage: StorageService
  ) {}

  /** Extrai o texto de um arquivo e salva como item (indexado) da base. */
  async extractAndStore(
    file: Express.Multer.File,
    opts: { title?: string; type?: KnowledgeType } = {}
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
      } else {
        throw new BadRequestException(
          `Formato .${ext} não suportado. Use PDF, DOCX, PPTX, XLSX, CSV ou TXT.`
        );
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(`Falha ao extrair o conteúdo do arquivo: ${(err as Error).message}`);
    }

    text = (text || "").trim().slice(0, MAX_CONTENT);
    if (!text) throw new BadRequestException("Não foi possível extrair texto do arquivo.");

    // Guarda o arquivo original no MinIO (opcional).
    let fileKey: string | undefined;
    if (this.storage.isEnabled) {
      const key = `knowledge/${Date.now()}-${name}`;
      fileKey = (await this.storage.upload(key, file.buffer, file.mimetype)) || undefined;
    }

    return this.create({
      title: opts.title || name,
      content: text,
      type: opts.type || KnowledgeType.OUTRO,
      fileKey,
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

  findAll() {
    return this.repo.find({ order: { updatedAt: "DESC" } });
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

    const chunks = this.chunkText(`${item.title}\n${item.content}`);
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
