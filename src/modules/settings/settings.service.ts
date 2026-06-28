import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Settings, AiProvider } from "./settings.entity";

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(Settings)
    private readonly repo: Repository<Settings>
  ) {}

  /** Retorna a linha única de configurações, criando-a se ainda não existir. */
  async get(): Promise<Settings> {
    let settings = await this.repo.findOne({ where: {}, order: { createdAt: "ASC" } });
    if (!settings) {
      settings = this.repo.create({ aiProvider: AiProvider.ANTHROPIC });
      settings = await this.repo.save(settings);
    }
    return settings;
  }

  /** Versão segura para o front: não expõe a chave de API completa. */
  async getPublic() {
    const s = await this.get();
    const { aiApiKey, ...rest } = s;
    return { ...rest, hasApiKey: !!aiApiKey };
  }

  async update(dto: Partial<Settings>) {
    const settings = await this.get();
    // Não sobrescreve a chave com vazio (permite manter a existente).
    if (dto.aiApiKey === "" || dto.aiApiKey === undefined) delete dto.aiApiKey;
    Object.assign(settings, dto);
    await this.repo.save(settings);
    return this.getPublic();
  }
}
