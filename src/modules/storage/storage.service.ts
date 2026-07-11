import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Client as MinioClient } from "minio";

/**
 * Armazenamento de arquivos no MinIO (S3-compatível).
 * É opcional: se as credenciais não estiverem configuradas, os métodos viram no-op
 * e o restante do sistema continua funcionando (apenas sem guardar o arquivo original).
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private client: MinioClient | null = null;
  private bucket: string;
  private enabled = false;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    // Preferência: Cloudflare R2 (S3-compatível) quando configurado.
    const r2Key = this.config.get<string>("R2_ACCESS_KEY_ID");
    const r2Secret = this.config.get<string>("R2_SECRET_ACCESS_KEY");
    if (r2Key && r2Secret) {
      const endpoint = (this.config.get<string>("R2_ENDPOINT", "") || "")
        .replace(/^https?:\/\//, "")
        .replace(/\/$/, "");
      this.bucket = this.config.get<string>("R2_BUCKET", "kayser-docs");
      this.client = new MinioClient({
        endPoint: endpoint,
        port: 443,
        useSSL: true,
        accessKey: r2Key,
        secretKey: r2Secret,
        region: "auto",
      });
      this.enabled = true; // o bucket é criado manualmente no painel do R2
      this.logger.log(`Cloudflare R2 conectado (bucket: ${this.bucket}).`);
      return;
    }

    const accessKey = this.config.get<string>("MINIO_ACCESS_KEY");
    const secretKey = this.config.get<string>("MINIO_SECRET_KEY");
    if (!accessKey || !secretKey) {
      this.logger.log("Storage (R2/MinIO) não configurado — armazenamento de arquivos desativado.");
      return;
    }
    this.bucket = this.config.get<string>("MINIO_BUCKET", "kayser-one");
    this.client = new MinioClient({
      endPoint: this.config.get<string>("MINIO_ENDPOINT", "localhost"),
      port: Number(this.config.get<number>("MINIO_PORT", 9000)),
      useSSL: this.config.get<string>("MINIO_USE_SSL") === "true",
      accessKey,
      secretKey,
    });
    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) await this.client.makeBucket(this.bucket, "");
      this.enabled = true;
      this.logger.log(`MinIO conectado (bucket: ${this.bucket}).`);
    } catch (err) {
      this.logger.warn(`Falha ao inicializar MinIO: ${(err as Error).message}`);
      this.client = null;
    }
  }

  get isEnabled() {
    return this.enabled && !!this.client;
  }

  /** Faz upload de um buffer e retorna a chave do objeto, ou null se desativado. */
  async upload(key: string, buffer: Buffer, contentType?: string): Promise<string | null> {
    if (!this.client) return null;
    try {
      await this.client.putObject(this.bucket, key, buffer, buffer.length, {
        "Content-Type": contentType || "application/octet-stream",
      });
      return key;
    } catch (err) {
      this.logger.warn(`Falha no upload para o MinIO: ${(err as Error).message}`);
      return null;
    }
  }

  /** Baixa um objeto como buffer + content-type, ou null se ausente/desativado. */
  async getObject(key: string): Promise<{ buffer: Buffer; contentType: string } | null> {
    if (!this.client) return null;
    try {
      const stat = await this.client.statObject(this.bucket, key);
      const stream = await this.client.getObject(this.bucket, key);
      const chunks: Buffer[] = [];
      for await (const chunk of stream as AsyncIterable<Buffer>) chunks.push(chunk);
      const contentType =
        (stat.metaData && (stat.metaData["content-type"] || stat.metaData["Content-Type"])) ||
        "application/octet-stream";
      return { buffer: Buffer.concat(chunks), contentType };
    } catch (err) {
      this.logger.warn(`Falha ao baixar do MinIO: ${(err as Error).message}`);
      return null;
    }
  }

  /** URL temporária para download (presigned), ou null se desativado. */
  async presignedUrl(key: string, expirySeconds = 3600): Promise<string | null> {
    if (!this.client) return null;
    try {
      return await this.client.presignedGetObject(this.bucket, key, expirySeconds);
    } catch (err) {
      this.logger.warn(`Falha ao gerar URL: ${(err as Error).message}`);
      return null;
    }
  }

  /** Lista as chaves dos objetos sob um prefixo. Vazio se desativado/erro. */
  async list(prefix: string): Promise<string[]> {
    if (!this.client) return [];
    try {
      const keys: string[] = [];
      const stream = this.client.listObjectsV2(this.bucket, prefix, true);
      for await (const obj of stream as AsyncIterable<{ name?: string }>) {
        if (obj?.name) keys.push(obj.name);
      }
      return keys;
    } catch (err) {
      this.logger.warn(`Falha ao listar objetos: ${(err as Error).message}`);
      return [];
    }
  }

  /** Remove um objeto do bucket. Não lança se falhar (apenas registra). */
  async remove(key: string): Promise<boolean> {
    if (!this.client) return false;
    try {
      await this.client.removeObject(this.bucket, key);
      return true;
    } catch (err) {
      this.logger.warn(`Falha ao remover objeto: ${(err as Error).message}`);
      return false;
    }
  }
}
