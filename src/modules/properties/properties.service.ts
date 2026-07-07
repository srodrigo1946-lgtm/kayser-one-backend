import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ILike, Repository } from "typeorm";
import { Property } from "./property.entity";

@Injectable()
export class PropertiesService {
  constructor(
    @InjectRepository(Property)
    private readonly repo: Repository<Property>
  ) {}

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
    Object.assign(property, dto);
    return this.repo.save(property);
  }

  async remove(id: string) {
    const property = await this.findOne(id);
    await this.repo.remove(property);
    return { deleted: true };
  }
}
