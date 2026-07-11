import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { exec } from "child_process";
import { promisify } from "util";
import { readFile, unlink } from "fs/promises";
import { StorageService } from "../storage/storage.service";

const execAsync = promisify(exec);

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly storage: StorageService
  ) {}

  /** Backup automático diário (03:00). Salva o dump do banco no R2. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async scheduledBackup() {
    try {
      const res = await this.runBackup();
      if (!res.ok) this.logger.warn(`Backup diário não realizado: ${res.reason}`);
    } catch (err) {
      this.logger.error(`Backup diário falhou: ${(err as Error).message}`);
    }
  }

  /**
   * Faz o pg_dump do banco (formato custom, pronto para pg_restore) e envia
   * para o R2 em backups/. Retorna a chave e o tamanho, ou o motivo da falha.
   */
  async runBackup(): Promise<{ ok: boolean; key?: string; size?: number; reason?: string }> {
    const databaseUrl = this.config.get<string>("DATABASE_URL");
    if (!databaseUrl) return { ok: false, reason: "DATABASE_URL ausente." };
    if (!this.storage.isEnabled) return { ok: false, reason: "R2 não configurado." };

    // Garante SSL quando a URL é pública (o servidor interno do Railway não exige).
    let url = databaseUrl;
    if (!/[?&]sslmode=/.test(url) && !url.includes(".railway.internal")) {
      url += (url.includes("?") ? "&" : "?") + "sslmode=require";
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19); // 2026-07-11T14-30-00
    const tmp = `/tmp/kayser-backup-${stamp}.dump`;
    const key = `backups/kayser-one_${stamp}.dump`;

    try {
      await execAsync(`pg_dump -Fc --no-owner --no-privileges "${url}" -f "${tmp}"`, {
        maxBuffer: 1024 * 1024 * 128,
      });
      const buffer = await readFile(tmp);
      const stored = await this.storage.upload(key, buffer, "application/octet-stream");
      if (!stored) return { ok: false, reason: "Falha ao enviar o backup para o R2." };
      this.logger.log(`Backup salvo no R2: ${key} (${buffer.length} bytes)`);
      return { ok: true, key, size: buffer.length };
    } catch (err) {
      const reason = ((err as any)?.stderr || (err as Error)?.message || String(err)).toString().slice(0, 500);
      this.logger.error(`Backup falhou: ${reason}`);
      return { ok: false, reason };
    } finally {
      await unlink(tmp).catch(() => {});
    }
  }
}
