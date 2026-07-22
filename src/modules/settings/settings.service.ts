import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Settings, AiProvider } from "./settings.entity";
import { StorageService } from "../storage/storage.service";

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(Settings)
    private readonly repo: Repository<Settings>,
    private readonly storage: StorageService
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

  /** Versão segura para o front: não expõe a chave de API nem a imagem (grande). */
  async getPublic() {
    const s = await this.get();
    const { aiApiKey, direcionalImage, ...rest } = s;
    return { ...rest, hasApiKey: !!aiApiKey, hasDirecionalImage: !!direcionalImage };
  }

  /** Salva a imagem de condições comerciais do mês (R2 quando ativo, senão data URI). */
  async setDirecionalImage(file: Express.Multer.File) {
    const settings = await this.get();
    const ext = (file.originalname.split(".").pop() || "png").toLowerCase();
    const key = `direcional/condicoes-${Date.now()}.${ext}`;
    const stored = await this.storage.upload(key, file.buffer, file.mimetype);
    settings.direcionalImage =
      stored || `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
    await this.repo.save(settings);
    return { ok: true };
  }

  /** Bytes da imagem para servir na <img> (decodifica data URI ou busca no R2). */
  async getDirecionalImageData(): Promise<{ buffer: Buffer; contentType: string } | null> {
    const s = await this.get();
    if (!s.direcionalImage) return null;
    if (s.direcionalImage.startsWith("data:")) {
      const m = s.direcionalImage.match(/^data:([^;]+);base64,(.*)$/);
      if (!m) return null;
      return { buffer: Buffer.from(m[2], "base64"), contentType: m[1] };
    }
    return this.storage.getObject(s.direcionalImage);
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
