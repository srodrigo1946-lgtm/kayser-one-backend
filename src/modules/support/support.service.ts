import { Injectable, BadRequestException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { SupportMessage } from "./support-message.entity";

@Injectable()
export class SupportService {
  constructor(
    @InjectRepository(SupportMessage)
    private readonly repo: Repository<SupportMessage>
  ) {}

  /** Cria uma mensagem vinda da caixinha pública (sem login). */
  async create(data: { name?: string; email?: string; type?: string; message?: string }) {
    const message = (data.message || "").trim();
    if (message.length < 3) throw new BadRequestException("Escreva a sua mensagem.");
    const type = data.type === "reclamacao" ? "reclamacao" : "suporte";
    const msg = this.repo.create({
      name: (data.name || "").trim() || undefined,
      email: (data.email || "").trim() || undefined,
      type,
      message: message.slice(0, 4000),
    });
    await this.repo.save(msg);
    return { ok: true };
  }

  list() {
    return this.repo.find({ order: { createdAt: "DESC" }, take: 200 });
  }

  async unreadCount() {
    const count = await this.repo.count({ where: { read: false } });
    return { count };
  }

  async markRead(id: string) {
    await this.repo.update({ id }, { read: true });
    return { ok: true };
  }

  async remove(id: string) {
    await this.repo.delete({ id });
    return { ok: true };
  }
}
