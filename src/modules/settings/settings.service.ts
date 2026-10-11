import { BadRequestException, Injectable } from "@nestjs/common";
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

  /** Versão segura para o front: não expõe chaves/tokens nem a imagem (grande). */
  async getPublic() {
    const s = await this.get();
    const { aiApiKey, audioApiKey, direcionalImage, metaPageToken, metaVerifyToken, ioneClaudeKey, ioneOpenaiKey, ioneUnidadesCsv, marcaLogo, ...rest } = s;
    return {
      ...rest,
      hasMarcaLogo: !!marcaLogo,
      hasIoneClaudeKey: !!ioneClaudeKey,
      hasIoneOpenaiKey: !!ioneOpenaiKey,
      hasIoneUnidadesCsv: !!ioneUnidadesCsv,
      hasApiKey: !!aiApiKey,
      hasAudioKey: !!audioApiKey,
      hasDirecionalImage: !!direcionalImage,
      hasMetaToken: !!metaPageToken,
      hasMetaVerify: !!metaVerifyToken,
    };
  }

  /** Chave/senha salva, pra o Diretor conferir (botão 👁). Só campos desta lista. */
  async segredo(campo: string): Promise<{ valor: string }> {
    const permitidos = ["metaPageToken", "metaVerifyToken"] as const;
    if (!(permitidos as readonly string[]).includes(campo)) return { valor: "" };
    const s = await this.get();
    return { valor: ((s as any)[campo] as string) || "" };
  }

  /** Marca própria pública (tela de login, título, app instalável): nome, cor e se tem logo. */
  async marca() {
    const s = await this.get();
    return {
      nome: s.marcaNome || "Kayser One",
      cor: s.marcaCor || null,
      temLogo: !!s.marcaLogo,
      // Muda quando o logo/nome/cor muda — o front usa pra furar o cache do logo.
      versao: s.updatedAt ? new Date(s.updatedAt as any).getTime() : 0,
    };
  }

  /** Logo da marca própria: só PNG/JPG/WEBP (SVG pode ter script). */
  async setMarcaLogo(file: Express.Multer.File | undefined) {
    if (!file || !/^image\/(png|jpeg|webp)$/.test(file.mimetype)) {
      throw new BadRequestException("Envie o logo em PNG, JPG ou WEBP.");
    }
    const s = await this.get();
    const ext = file.mimetype.split("/")[1].replace("jpeg", "jpg");
    const stored = await this.storage.upload(`marca/logo-${Date.now()}.${ext}`, file.buffer, file.mimetype);
    s.marcaLogo = stored || `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
    await this.repo.save(s);
    return { ok: true };
  }

  async removerMarcaLogo() {
    const s = await this.get();
    s.marcaLogo = null;
    await this.repo.save(s);
    return { ok: true };
  }

  async getMarcaLogo(): Promise<{ buffer: Buffer; contentType: string } | null> {
    const s = await this.get();
    if (!s.marcaLogo) return null;
    if (s.marcaLogo.startsWith("data:")) {
      const m = s.marcaLogo.match(/^data:([^;]+);base64,(.*)$/);
      return m ? { buffer: Buffer.from(m[2], "base64"), contentType: m[1] } : null;
    }
    return this.storage.getObject(s.marcaLogo);
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
    // Não sobrescreve segredos com vazio (permite manter os existentes).
    for (const k of ["aiApiKey", "audioApiKey", "metaPageToken", "metaVerifyToken", "ioneClaudeKey", "ioneOpenaiKey"] as const) {
      if (dto[k] === "" || dto[k] === undefined) delete dto[k];
    }
    Object.assign(settings, dto);
    await this.repo.save(settings);
    return this.getPublic();
  }
}
