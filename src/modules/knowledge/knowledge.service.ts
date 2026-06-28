import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import * as XLSX from "xlsx";
import { KnowledgeItem, KnowledgeType } from "./knowledge.entity";

// Limite de caracteres por documento para manter o prompt da IA gerenciável.
const MAX_CONTENT = 20000;

@Injectable()
export class KnowledgeService {
  constructor(
    @InjectRepository(KnowledgeItem)
    private readonly repo: Repository<KnowledgeItem>
  ) {}

  /** Extrai o texto de um arquivo (PDF/DOCX/XLSX/CSV/TXT) e salva como item da base. */
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
          `Formato .${ext} não suportado. Use PDF, DOCX, XLSX, CSV ou TXT.`
        );
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(`Falha ao extrair o conteúdo do arquivo: ${(err as Error).message}`);
    }

    text = (text || "").trim().slice(0, MAX_CONTENT);
    if (!text) throw new BadRequestException("Não foi possível extrair texto do arquivo.");

    return this.create({
      title: opts.title || name,
      content: text,
      type: opts.type || KnowledgeType.OUTRO,
    });
  }

  findAll() {
    return this.repo.find({ order: { updatedAt: "DESC" } });
  }

  create(dto: Partial<KnowledgeItem>) {
    const item = this.repo.create(dto);
    return this.repo.save(item);
  }

  async update(id: string, dto: Partial<KnowledgeItem>) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException("Item não encontrado.");
    Object.assign(item, dto);
    return this.repo.save(item);
  }

  async remove(id: string) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException("Item não encontrado.");
    await this.repo.remove(item);
    return { message: "Item removido." };
  }

  /** Monta um bloco de texto com todo o conhecimento ativo para injetar no prompt da IA. */
  async buildContext(): Promise<string> {
    const items = await this.repo.find({ where: { active: true }, order: { type: "ASC" } });
    if (!items.length) return "";
    return items
      .map((i) => `### ${i.title} (${i.type})\n${i.content}`)
      .join("\n\n");
  }
}
