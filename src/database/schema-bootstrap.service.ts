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
    // Cada passo é independente: se um falhar, os demais ainda rodam.
    const steps: Array<[string, () => Promise<void>]> = [
      ["ensureLeadSource", () => this.ensureLeadSource()],
      ["ensureLeadValorVenda", () => this.ensureLeadValorVenda()],
      ["ensureLeadCadastroCompleto", () => this.ensureLeadCadastroCompleto()],
      ["ensurePastaTable", () => this.ensurePastaTable()],
      ["ensureEmpresaTable", () => this.ensureEmpresaTable()],
      ["ensureEmpresaUser", () => this.ensureEmpresaUser()],
      ["ensureSettingsColumns", () => this.ensureSettingsColumns()],
      ["ensureUserAiColumns", () => this.ensureUserAiColumns()],
    ];
    for (const [name, run] of steps) {
      try {
        await run();
      } catch (err) {
        this.logger.warn(`SchemaBootstrap ${name} falhou (seguindo): ${(err as Error).message}`);
      }
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

  /** Valor da venda fechada (base do VGV / campeão do dashboard). */
  private async ensureLeadValorVenda() {
    await this.dataSource.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS "valorVenda" numeric`);
  }

  /** Cadastro completo do cliente (financiamento / Subir Pasta para Análise). */
  private async ensureLeadCadastroCompleto() {
    const cols: [string, string][] = [
      ["cpf", "varchar"],
      ["dataNascimento", "date"],
      ["estadoCivil", "varchar"],
      ["cep", "varchar"],
      ["logradouro", "varchar"],
      ["numero", "varchar"],
      ["complemento", "varchar"],
      ["bairro", "varchar"],
      ["estado", "varchar"],
    ];
    for (const [name, type] of cols) {
      await this.dataSource.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS "${name}" ${type}`);
    }
  }

  /** Tabela da pasta de análise (entidade nova; synchronize está off em produção). */
  private async ensurePastaTable() {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS analysis_folders (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "leadId" uuid NOT NULL,
        "clientName" varchar NOT NULL,
        "clientCpf" varchar,
        "propertyId" uuid,
        empreendimento varchar,
        construtora varchar,
        unidade varchar,
        bloco varchar,
        apartamento varchar,
        "valorAvaliacao" numeric,
        "valorVendaFinal" numeric,
        "condicoesComerciais" text,
        observacoes text,
        fase varchar DEFAULT 'simplificada',
        perfil varchar DEFAULT 'clt',
        "documentRequestId" uuid,
        "docToken" varchar,
        "empresaId" uuid,
        parecer text,
        status varchar DEFAULT 'montando',
        "responsavelId" uuid,
        "createdById" uuid,
        "createdAt" timestamp DEFAULT now(),
        "updatedAt" timestamp DEFAULT now()
      )
    `);
    // Conserta a tabela caso já tenha sido criada sem o default (id nulo dava 500).
    await this.dataSource.query(
      `ALTER TABLE analysis_folders ALTER COLUMN id SET DEFAULT gen_random_uuid()`
    );
    // Coluna adicionada depois (Fase 3b): token do ambiente de documentos.
    await this.dataSource.query(`ALTER TABLE analysis_folders ADD COLUMN IF NOT EXISTS "docToken" varchar`);
  }

  /** Tabela de empresas parceiras (entidade nova). */
  private async ensureEmpresaTable() {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS partner_companies (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        cnpj varchar NOT NULL,
        email varchar NOT NULL,
        nome varchar,
        status varchar DEFAULT 'pendente',
        "createdById" uuid,
        "createdAt" timestamp DEFAULT now(),
        "updatedAt" timestamp DEFAULT now()
      )
    `);
    await this.dataSource.query(
      `ALTER TABLE partner_companies ALTER COLUMN id SET DEFAULT gen_random_uuid()`
    );
  }

  /** Login da empresa parceira: marca users.empresaId (o usuário fica com cargo
   *  corretor + empresaId; não depende de novo valor no enum de cargos). */
  private async ensureEmpresaUser() {
    await this.dataSource.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "empresaId" uuid`);
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
