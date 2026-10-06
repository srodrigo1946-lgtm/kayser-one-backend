import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ILike, Repository } from "typeorm";
import { Property } from "./property.entity";
import { StorageService } from "../storage/storage.service";

@Injectable()
export class PropertiesService {
  constructor(
    @InjectRepository(Property)
    private readonly repo: Repository<Property>,
    private readonly storage: StorageService
  ) {}

  /** Book (PDF) do empreendimento: R2 quando ativo, senão no banco (bookData). */
  async setBook(id: string, file: Express.Multer.File) {
    if (!file?.buffer?.length) throw new BadRequestException("Envie o arquivo PDF.");
    if (!/pdf/i.test(file.mimetype) && !/.pdf$/i.test(file.originalname)) throw new BadRequestException("O book precisa ser PDF.");
    await this.findOne(id);
    const key = await this.storage.upload(`books/${id}-${Date.now()}.pdf`, file.buffer, "application/pdf");
    await this.repo.update(id, {
      bookKey: key || "db",
      bookNome: file.originalname || "book.pdf",
      bookData: key ? null : file.buffer.toString("base64"),
    } as any);
    return { ok: true, bookNome: file.originalname };
  }

  async getBook(id: string): Promise<{ buffer: Buffer; nome: string } | null> {
    const p = await this.repo.findOne({ where: { id }, select: ["id", "name", "bookKey", "bookNome", "bookData"] as any });
    if (!p?.bookKey) return null;
    const nome = p.bookNome || `Book ${p.name}.pdf`;
    if (p.bookKey === "db") return p.bookData ? { buffer: Buffer.from(p.bookData, "base64"), nome } : null;
    const o = await this.storage.getObject(p.bookKey);
    return o ? { buffer: o.buffer, nome } : null;
  }

  async removeBook(id: string) {
    await this.repo.update(id, { bookKey: null, bookNome: null, bookData: null } as any);
    return { ok: true };
  }

  async findAll(search?: string) {
    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      return this.repo.find({
        where: [
          { name: ILike(q) },
          { cidade: ILike(q) },
          { bairro: ILike(q) },
          { construtora: ILike(q) },
        ],
        order: { createdAt: "DESC" },
      });
    }
    return this.repo.find({ order: { createdAt: "DESC" } });
  }

  async findOne(id: string) {
    const property = await this.repo.findOne({ where: { id } });
    if (!property) throw new NotFoundException("Imóvel não encontrado.");
    return property;
  }

  create(dto: Partial<Property>) {
    const property = this.repo.create(dto);
    return this.repo.save(property);
  }

  async update(id: string, dto: Partial<Property>) {
    const property = await this.findOne(id);
    // Endereço do stand mudou → a coordenada antiga (check-in do plantão) não vale mais;
    // zera pra ser localizada de novo (botão Localizar / cron das 06:30).
    if (dto.standAddress !== undefined && (dto.standAddress || "").trim() !== (property.standAddress || "").trim()) {
      (dto as any).standLat = null;
      (dto as any).standLng = null;
    }
    Object.assign(property, dto);
    return this.repo.save(property);
  }

  async remove(id: string) {
    const property = await this.findOne(id);
    await this.repo.remove(property);
    return { deleted: true };
  }
}
