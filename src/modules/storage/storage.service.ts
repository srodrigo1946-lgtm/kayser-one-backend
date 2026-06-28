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
    const accessKey = this.config.get<string>("MINIO_ACCESS_KEY");
    const secretKey = this.config.get<string>("MINIO_SECRET_KEY");
    if (!accessKey || !secretKey) {
      this.logger.log("MinIO não configurado — armazenamento de arquivos desativado.");
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
}
