import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { exec } from "child_process";
import { promisify } from "util";
import { readFile, unlink } from "fs/promises";
import { StorageService } from "../storage/storage.service";
import { DataSource } from "typeorm";

const execAsync = promisify(exec);

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly storage: StorageService,
    private readonly db: DataSource
  ) {}

  /** Espaço do banco (volume de 500 MB, alerta 79% em 25/11): tabelas maiores + mídia guardada dentro do banco. */
  async espaco() {
    const [total] = await this.db.query(`SELECT pg_database_size(current_database())::bigint AS bytes`);
    const tabelas = await this.db.query(
      `SELECT relname AS tabela, pg_total_relation_size(relid)::bigint AS bytes, n_live_tup::bigint AS linhas, n_dead_tup::bigint AS mortas
         FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 15`
    );
    const [midia] = await this.db.query(
      `SELECT count(*)::int AS qtd, COALESCE(sum(length("mediaKey")), 0)::bigint AS bytes FROM messages WHERE "mediaKey" LIKE 'data:%'`
    );
    const mb = (b: any) => Math.round(Number(b) / 1048576);
    return {
      totalMB: mb(total.bytes),
      tabelas: tabelas.map((t: any) => ({ tabela: t.tabela, mb: mb(t.bytes), linhas: Number(t.linhas), mortas: Number(t.mortas) })),
      midiaNoBanco: { mensagens: midia.qtd, mb: mb(midia.bytes) },
      r2: this.storage.isEnabled,
    };
  }

  /** Tira a mídia (data URI) de dentro do banco e manda pro R2, em lotes. Libera espaço pra reuso. */
  async moverMidia(lote = 200) {
    if (!this.storage.isEnabled) return { movidas: 0, motivo: "R2 não configurado." };
    const rows: { id: string; conversationId: string; mediaKey: string }[] = await this.db.query(
      `SELECT id, "conversationId", "mediaKey" FROM messages WHERE "mediaKey" LIKE 'data:%' LIMIT $1`,
      [Math.min(Math.max(lote, 1), 500)]
    );
    let movidas = 0;
    for (const r of rows) {
      const m = r.mediaKey.match(/^data:(.+?);base64,(.*)$/s);
      if (!m) continue;
      const ext = (m[1].split("/")[1] || "bin").split(";")[0];
      const key = await this.storage.upload(`whatsapp/${r.conversationId}/${r.id}.${ext}`, Buffer.from(m[2], "base64"), m[1]);
      if (!key) break; // R2 falhou: para e tenta de novo depois
      await this.db.query(`UPDATE messages SET "mediaKey" = $1 WHERE id = $2`, [key, r.id]);
      movidas++;
    }
    const [resto] = await this.db.query(`SELECT count(*)::int AS n FROM messages WHERE "mediaKey" LIKE 'data:%'`);
    this.logger.log(`Mídia → R2: ${movidas} movida(s), faltam ${resto.n}.`);
    return { movidas, faltam: resto.n };
  }

  /** Devolve ao disco o espaço liberado de uma tabela (VACUUM FULL trava a tabela por alguns segundos). */
  async compactar(tabela: string) {
    const ok: string[] = (await this.db.query(`SELECT relname FROM pg_stat_user_tables`)).map((r: any) => r.relname);
    if (!ok.includes(tabela)) return { ok: false, motivo: "Tabela não existe." };
    const antes = await this.espaco();
    await this.db.query(`VACUUM FULL "${tabela}"`);
    const depois = await this.espaco();
    return { ok: true, antesMB: antes.totalMB, depoisMB: depois.totalMB };
  }

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
      await this.pruneOldBackups().catch(() => {});
      return { ok: true, key, size: buffer.length };
    } catch (err) {
      // Nunca devolve a URL do banco (tem senha) na mensagem de erro (auditoria 19/10).
      const reason = ((err as any)?.stderr || (err as Error)?.message || String(err))
        .toString()
        .split(url).join("***")
        .split(databaseUrl).join("***")
        .replace(/postgres(ql)?:\/\/[^\s"]+/gi, "***")
        .slice(0, 500);
      this.logger.error(`Backup falhou: ${reason}`);
      return { ok: false, reason };
    } finally {
      await unlink(tmp).catch(() => {});
    }
  }

  /** Mantém apenas os N backups mais recentes no R2 (nomes com timestamp ordenam sozinhos). */
  private async pruneOldBackups(keep = 14) {
    const keys = (await this.storage.list("backups/")).filter((k) => k.endsWith(".dump")).sort();
    const toDelete = keys.slice(0, Math.max(0, keys.length - keep));
    for (const k of toDelete) await this.storage.remove(k);
    if (toDelete.length) this.logger.log(`Backups antigos removidos: ${toDelete.length}`);
  }
}
