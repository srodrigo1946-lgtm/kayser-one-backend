import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { DataSource } from "typeorm";

/**
 * Aplica ajustes de schema idempotentes no startup.
 *
 * O projeto não usa migrations e roda com DB_SYNC=false em produção, então colunas
 * novas precisam ser adicionadas manualmente aqui (ADD COLUMN IF NOT EXISTS). É seguro
 * rodar sempre: cada passo é no-op quando a coluna já existe.
 */
@Injectable()
export class SchemaBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(SchemaBootstrapService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit() {
    // Só no Postgres (produção). Em sqlite/testes o synchronize cuida do schema.
    if (this.dataSource.options.type !== "postgres") return;
    try {
      await this.ensureLeadSource();
      await this.ensureSettingsColumns();
      await this.ensureUserAiColumns();
    } catch (err) {
      this.logger.warn(`SchemaBootstrap falhou (seguindo mesmo assim): ${(err as Error).message}`);
    }
  }

  /** leads.source + backfill único (só quando a coluna é criada agora). */
  private async ensureLeadSource() {
    const exists = await this.dataSource.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'source'`
    );
    if (exists.length) return;

    await this.dataSource.query(
      `ALTER TABLE leads ADD COLUMN "source" varchar NOT NULL DEFAULT 'manual'`
    );
    // Backfill: anúncio pela origem conhecida; orgânico quando o nome é o próprio número.
    await this.dataSource.query(
      `UPDATE leads SET "source" = 'anuncio'
       WHERE lower(coalesce(origem, '')) IN ('facebook','instagram','tiktok','meta ads','google ads')`
    );
    await this.dataSource.query(
      `UPDATE leads SET "source" = 'whatsapp' WHERE "source" = 'manual' AND name = phone`
    );
    this.logger.log("Coluna leads.source criada e backfill aplicado.");
  }

  /** Colunas novas de follow-up em settings (defaults tratados no código). */
  private async ensureSettingsColumns() {
    await this.dataSource.query(
      `ALTER TABLE settings ADD COLUMN IF NOT EXISTS "followupSources" text DEFAULT 'anuncio,manual'`
    );
    await this.dataSource.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS "followupMsgManha" text`);
    await this.dataSource.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS "followupMsgTarde" text`);
    await this.dataSource.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS "followupMsgNoite" text`);
  }

  /** IA por usuário: provedor/modelo/chave próprios (chave é opcional). */
  private async ensureUserAiColumns() {
    await this.dataSource.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "aiProvider" varchar`);
    await this.dataSource.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "aiModel" varchar`);
    await this.dataSource.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "aiApiKey" text`);
    await this.dataSource.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "recoveryCodeHash" text`);
  }
}
