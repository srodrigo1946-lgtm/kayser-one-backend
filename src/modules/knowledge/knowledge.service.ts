import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { KnowledgeItem } from "./knowledge.entity";

@Injectable()
export class KnowledgeService {
  constructor(
    @InjectRepository(KnowledgeItem)
    private readonly repo: Repository<KnowledgeItem>
  ) {}

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
