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
      ["ensureDataVendaBackfill", () => this.ensureDataVendaBackfill()],
      ["ensureLeadCadastroCompleto", () => this.ensureLeadCadastroCompleto()],
      ["ensurePastaTable", () => this.ensurePastaTable()],
      ["ensureEmpresaTable", () => this.ensureEmpresaTable()],
      ["ensureEmpresaUser", () => this.ensureEmpresaUser()],
      ["ensureDocRequestExtra", () => this.ensureDocRequestExtra()],
      ["ensureSupportTable", () => this.ensureSupportTable()],
      ["ensureSettingsColumns", () => this.ensureSettingsColumns()],
      ["ensureUserAiColumns", () => this.ensureUserAiColumns()],
      ["ensurePropertyDeliveryDate", () => this.ensurePropertyDeliveryDate()],
      ["ensurePropertyStandAddress", () => this.ensurePropertyStandAddress()],
      ["ensureKnowledgePropertyId", () => this.ensureKnowledgePropertyId()],
      ["cancelarVisitasIaOrfas", () => this.cancelarVisitasIaOrfas()],
      ["ensureMeetingsTable", () => this.ensureMeetingsTable()],
      ["ensureConversationIsGroup", () => this.ensureConversationIsGroup()],
      ["ensureEscalaTable", () => this.ensureEscalaTable()],
      ["ensureAdInvestmentTable", () => this.ensureAdInvestmentTable()],
      ["ensureAdInvestmentDayTable", () => this.ensureAdInvestmentDayTable()],
      ["ensureFeedbackTable", () => this.ensureFeedbackTable()],
      ["ensureAssignmentAgendado", () => this.ensureAssignmentAgendado()],
      ["ensureLeadsBloqueados", () => this.ensureLeadsBloqueados()],
      ["ensureKanbanSomenteGestores", () => this.ensureKanbanSomenteGestores()],
      ["arquivarSemInteresse", () => this.arquivarSemInteresse()],
      ["desfazerImportCorujao3009", () => this.desfazerImportCorujao3009()],
      ["ensureLeadImports", () => this.ensureLeadImports()],
      ["corujaoParaPrimeiroContato", () => this.corujaoParaPrimeiroContato()],
      ["corujaoMarcaEntrada", () => this.corujaoMarcaEntrada()],
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

  /** Valor + DATA da venda fechada (base do VGV / campeão do dashboard). */
  private async ensureLeadValorVenda() {
    await this.dataSource.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS "valorVenda" numeric`);
    await this.dataSource.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS "dataVenda" date`);
    await this.dataSource.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS "corujaoLiberado" boolean NOT NULL DEFAULT false`);
    // Proteção do WhatsApp: cliente pediu pra parar = sem follow-up (29/09/2026).
    await this.dataSource.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS "naoPerturbe" boolean NOT NULL DEFAULT false`);
  }

  /**
   * Backfill de dataVenda pras vendas ANTIGAS sem data: usa a data em que virou
   * "venda_ganha" no histórico (confiável); se não houver histórico, cai no
   * updatedAt. Só toca em quem está NULL — idempotente.
   */
  private async ensureDataVendaBackfill() {
    await this.dataSource
      .query(`
        UPDATE leads l SET "dataVenda" = sub.dt
        FROM (
          SELECT lh."leadId", MAX(lh."createdAt")::date AS dt
          FROM lead_history lh
          WHERE lh."toStatus" = 'venda_ganha'
          GROUP BY lh."leadId"
        ) sub
        WHERE l.id = sub."leadId" AND l.status = 'venda_ganha' AND l."dataVenda" IS NULL
      `)
      .catch(() => {});
    await this.dataSource
      .query(`UPDATE leads SET "dataVenda" = "updatedAt"::date WHERE status = 'venda_ganha' AND "dataVenda" IS NULL`)
      .catch(() => {});
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
    // Número sequencial da análise ("Análise 01"). Backfill por ordem de criação nas linhas sem número.
    await this.dataSource.query(`ALTER TABLE analysis_folders ADD COLUMN IF NOT EXISTS numero int`);
    // Fase 5: momento da liberação dos documentos p/ a empresa (janela de 40 min).
    await this.dataSource.query(`ALTER TABLE analysis_folders ADD COLUMN IF NOT EXISTS "docsReleasedAt" timestamp`);
    await this.dataSource.query(`
      UPDATE analysis_folders af
      SET numero = sub.rn + COALESCE((SELECT MAX(numero) FROM analysis_folders WHERE numero IS NOT NULL), 0)
      FROM (
        SELECT id, row_number() OVER (ORDER BY "createdAt") AS rn
        FROM analysis_folders WHERE numero IS NULL
      ) sub
      WHERE af.id = sub.id
    `);
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

  /** Pendências extras pedidas depois (documentos que faltam) no link de docs. */
  private async ensureDocRequestExtra() {
    await this.dataSource.query(`ALTER TABLE document_requests ADD COLUMN IF NOT EXISTS "extraDocs" text`);
  }

  /** Caixinha pública de suporte/reclamação (tela de login). */
  private async ensureSupportTable() {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS support_messages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar,
        email varchar,
        type varchar DEFAULT 'suporte',
        message text NOT NULL,
        read boolean DEFAULT false,
        "createdAt" timestamp DEFAULT now()
      )
    `);
    await this.dataSource.query(
      `ALTER TABLE support_messages ALTER COLUMN id SET DEFAULT gen_random_uuid()`
    );
  }

  /** Colunas novas de follow-up em settings (defaults tratados no código). */
  private async ensureSettingsColumns() {
    await this.dataSource.query(
      `ALTER TABLE settings ADD COLUMN IF NOT EXISTS "followupSources" text DEFAULT 'anuncio,whatsapp,manual'`
    );
    await this.dataSource.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS "followupMsgManha" text`);
    // 28/09/2026: follow-up passa a incluir os leads do número central sem anúncio
    // (origem whatsapp). Só troca quem ainda estava no padrão antigo.
    // Roda UMA vez: enquanto o DEFAULT da coluna ainda é o antigo. Depois disso, se o Diretor
    // desmarcar "WhatsApp" nas Configurações, o deploy não volta a marcar sozinho.
    const [col] = await this.dataSource.query(
      `SELECT column_default FROM information_schema.columns WHERE table_name = 'settings' AND column_name = 'followupSources'`
    );
    if (!String(col?.column_default ?? "").includes("anuncio,whatsapp,manual")) {
      await this.dataSource.query(
        `UPDATE settings SET "followupSources" = 'anuncio,whatsapp,manual' WHERE "followupSources" = 'anuncio,manual'`
      );
      await this.dataSource.query(`ALTER TABLE settings ALTER COLUMN "followupSources" SET DEFAULT 'anuncio,whatsapp,manual'`);
    }
    // Chave da OpenAI pra transcrever áudio dos clientes (campo na página IA).
    await this.dataSource.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS "audioApiKey" varchar`);
    await this.dataSource.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS "followupMsgTarde" text`);
    await this.dataSource.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS "followupMsgNoite" text`);
    await this.dataSource.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS "direcionalImage" text`);
    await this.dataSource.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS "metaPageToken" text`);
    await this.dataSource.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS "metaVerifyToken" text`);
    // Formulários permitidos. 1ª vez: só o "Ilha stay lead" (pedido do Rodrigo, 28/09/2026).
    await this.dataSource.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS "metaFormIds" text`);
    await this.dataSource.query(`UPDATE settings SET "metaFormIds" = '960631980396672' WHERE "metaFormIds" IS NULL`);
    await this.dataSource.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS "direcionalUrl" text`);
    // Contingência do WhatsApp central (29/09/2026).
    await this.dataSource.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS "whatsappPausado" boolean NOT NULL DEFAULT false`);
    // Origem "Corujão" na lista de origens do lead (30/09/2026) — só acrescenta se faltar.
    await this.dataSource.query(
      `UPDATE settings SET "leadOrigens" = CASE WHEN COALESCE("leadOrigens", '') = '' THEN 'Corujão' ELSE "leadOrigens" || ',Corujão' END
       WHERE COALESCE("leadOrigens", '') NOT ILIKE '%coruj%' AND "updatedAt" < '2026-09-30 21:30:00'`
    );
    // Custo por Lead puxando o gasto do Meta (29/09/2026). 1ª vez: a conta do Rodrigo.
    await this.dataSource.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS "metaAdAccountIds" text`);
    await this.dataSource.query(`UPDATE settings SET "metaAdAccountIds" = '542408373588337' WHERE "metaAdAccountIds" IS NULL`);
    await this.dataSource.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS "tabelaRivaUrl" text`);
    await this.dataSource.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS "custoLeadVisivel" boolean NOT NULL DEFAULT false`);
    await this.dataSource.query(
      `ALTER TABLE settings ADD COLUMN IF NOT EXISTS "leadOrigens" text DEFAULT 'Time Tati,Time Helen,Time Allan,Time Marisa,Time Isabelle,Time Isaac,Time Andre,Time Edjane'`
    );
    // Corujão (repique)
    await this.dataSource.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS "corujaoEnabled" boolean NOT NULL DEFAULT false`);
    await this.dataSource.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS "corujaoHora" varchar NOT NULL DEFAULT '14:00'`);
    await this.dataSource.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS "corujaoStatus" text`);
    await this.dataSource.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS "corujaoIncluirDiretor" boolean NOT NULL DEFAULT true`);
    // Limite diário de leads do Corujão por corretor (01/10/2026 — pedido do Rodrigo: 20).
    await this.dataSource.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS "corujaoLimiteDia" int NOT NULL DEFAULT 20`);
    await this.dataSource.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS "checkinObrigatorio" boolean NOT NULL DEFAULT true`);
    await this.dataSource.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS "plantaoLivreDesde" text`);
    await this.dataSource.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS "corujaoLastRun" text`);
    await this.dataSource.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS "corujaoAutoQtd" int NOT NULL DEFAULT 0`);
    await this.dataSource.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS "corujaoAgendadoPara" timestamp`);
    await this.dataSource.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "corujao" boolean NOT NULL DEFAULT false`);
  }

  /** Anotações de 1-on-1 / feedback (individual ou de time). */
  private async ensureFeedbackTable() {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS feedback_notes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "alvoTipo" varchar DEFAULT 'user',
        "alvoId" uuid NOT NULL,
        "autorId" uuid NOT NULL,
        texto text NOT NULL,
        "createdAt" timestamp DEFAULT now()
      )`);
  }

  /** Lead agendado: horário a partir do qual a atribuição "aguardando" entra no rodízio. */
  private async ensureAssignmentAgendado() {
    await this.dataSource.query(
      `ALTER TABLE lead_queue_assignments ADD COLUMN IF NOT EXISTS "agendadoPara" timestamp`
    );
  }

  /** Investimento em anúncio por mês (custo por lead). */
  private async ensureAdInvestmentTable() {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS ad_investments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        ano int NOT NULL,
        mes int NOT NULL,
        valor numeric DEFAULT 0,
        fonte varchar DEFAULT 'manual',
        UNIQUE (ano, mes)
      )`);
  }

  /** Gasto em anúncio por DIA (manual do Diretor ou empurrado por integração). */
  private async ensureAdInvestmentDayTable() {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS ad_investment_days (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        ano int NOT NULL,
        mes int NOT NULL,
        dia int NOT NULL,
        valor numeric DEFAULT 0,
        fonte varchar DEFAULT 'manual',
        UNIQUE (ano, mes, dia)
      )`);
  }

  /** Escala de Atendimento — turnos de plantão (7 dias × 3 turnos). */
  private async ensureEscalaTable() {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS escala_turnos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "diaSemana" int NOT NULL,
        turno int NOT NULL,
        "horaInicio" varchar NOT NULL,
        "horaFim" varchar NOT NULL,
        "atendenteIds" text DEFAULT ''
      )`);
  }

  /** Marca conversas de grupo (@g.us) — grupo nunca vira lead. */
  private async ensureConversationIsGroup() {
    await this.dataSource.query(
      `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS "isGroup" boolean NOT NULL DEFAULT false`
    );
    await this.dataSource.query(
      `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS "naoLead" boolean NOT NULL DEFAULT false`
    );
  }

  /** Previsão de entrega do empreendimento (texto livre). */
  private async ensurePropertyDeliveryDate() {
    await this.dataSource.query(`ALTER TABLE properties ADD COLUMN IF NOT EXISTS "deliveryDate" varchar`);
  }

  /**
   * Visitas agendadas pela IA cujo lead foi EXCLUÍDO (leadId virou null) ficavam na Agenda
   * e nos avisos. Cancela. Idempotente (roda a cada deploy, só pega as órfãs).
   */
  private async cancelarVisitasIaOrfas() {
    await this.dataSource.query(
      `UPDATE appointments SET status = 'cancelado'
        WHERE "leadId" IS NULL AND status = 'agendado' AND notes LIKE '%Agendado pela IA%'`
    );
  }

  /** Conhecimento do Kayser separado por empreendimento. */
  private async ensureKnowledgePropertyId() {
    await this.dataSource.query(`ALTER TABLE knowledge_items ADD COLUMN IF NOT EXISTS "propertyId" varchar`);
  }

  /** Endereço do stand de vendas do empreendimento (cartão da visita pro cliente). */
  private async ensurePropertyStandAddress() {
    await this.dataSource.query(`ALTER TABLE properties ADD COLUMN IF NOT EXISTS "standAddress" varchar`);
    // Check-in do plantão por GPS (01/10/2026): coordenada do stand + tabela de check-ins.
    await this.dataSource.query(`ALTER TABLE properties ADD COLUMN IF NOT EXISTS "standLat" double precision`);
    await this.dataSource.query(`ALTER TABLE properties ADD COLUMN IF NOT EXISTS "standLng" double precision`);
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS plantao_checkins (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" varchar NOT NULL,
        "turnoId" varchar NOT NULL,
        data varchar(10) NOT NULL,
        "propertyId" varchar,
        "standNome" varchar,
        lat double precision NOT NULL,
        lng double precision NOT NULL,
        distancia int NOT NULL,
        "createdAt" timestamp NOT NULL DEFAULT now()
      )`);
    await this.dataSource.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_plantao_checkin_unico ON plantao_checkins ("userId", "turnoId", data)`
    );
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS plantao_bloqueios (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" varchar NOT NULL,
        "porId" varchar NOT NULL,
        "porNome" varchar NOT NULL,
        "porDiretor" boolean NOT NULL DEFAULT false,
        "createdAt" timestamp NOT NULL DEFAULT now()
      )`);
    await this.dataSource.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_plantao_bloqueio_user ON plantao_bloqueios ("userId")`);

    // Endereços dos stands passados pelo Rodrigo (27/09/2026). Casa pelo nome do
    // imóvel e SÓ preenche se estiver vazio — edição feita na tela de Imóveis vence.
    const stands: [string, string][] = [
      ["%renascen%", "Rua Barão de São Francisco, 177 – Andaraí, Rio de Janeiro/RJ"],
      ["%ilhamar%", "Praça Professora Heley Batista, s/n – Barra Olímpica, Rio de Janeiro – RJ, 22783-116"],
      ["%oceanside%", "Av. das Américas, 18500 – Recreio dos Bandeirantes, Rio de Janeiro – RJ, 22790-704"],
      ["%vibe%", "Av. Salvador Allende, 5500 – Recreio dos Bandeirantes, Rio de Janeiro – RJ, 22780-160"],
      ["%beon%", "R. São Cristóvão, 356 – São Cristóvão, Rio de Janeiro – RJ"],
      ["%villa sant%", "R. Lopo Saraiva, 179, Loja A – Pechincha, Rio de Janeiro – RJ"],
      ["%marine%", "Praça Professora Heley Batista, s/n – Barra Olímpica, Rio de Janeiro – RJ"],
      ["%ilha stay%", "Praça Professora Heley Batista, s/n – Barra Olímpica, Rio de Janeiro/RJ"],
      ["%sky%", "Av. Mário Guimarães, 517 – Centro, Nova Iguaçu – RJ"],
    ];
    for (const [nome, endereco] of stands) {
      await this.dataSource.query(
        `UPDATE properties SET "standAddress" = $1
          WHERE lower(name) LIKE $2 AND ("standAddress" IS NULL OR "standAddress" = '')`,
        [endereco, nome]
      );
    }
    // 01/10: o mapa reserva (Photon) pôs o stand da Pça Heley Batista (Barra Olímpica)
    // numa praça de São Cristóvão. Barra Olímpica fica a oeste de -43,3 → apaga o ponto errado.
    await this.dataSource.query(
      `UPDATE properties SET "standLat" = NULL, "standLng" = NULL
        WHERE "standAddress" ILIKE '%heley%' AND "standLng" > -43.3`
    );
  }

  /** Reuniões em vídeo (aba Reuniões). */
  private async ensureMeetingsTable() {
    await this.dataSource.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS "meetingId" uuid`);
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS meetings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        title varchar NOT NULL,
        "roomName" varchar NOT NULL,
        "scheduledAt" timestamp NOT NULL,
        "durationMin" int NOT NULL DEFAULT 90,
        notes text,
        status varchar NOT NULL DEFAULT 'agendada',
        "hostId" uuid,
        "participantIds" text,
        "appointmentId" uuid,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now()
      )
    `);
  }

  /** IA por usuário: provedor/modelo/chave próprios (chave é opcional). */
  private async ensureUserAiColumns() {
    await this.dataSource.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "aiProvider" varchar`);
    await this.dataSource.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "aiModel" varchar`);
    await this.dataSource.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "aiApiKey" text`);
    await this.dataSource.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "recoveryCodeHash" text`);
  }

  /**
   * Leads pegos no Corujão ANTES da regra "entra em Primeiro Contato" (01/10/2026 14:41)
   * ficaram em Novo Lead — passam pra Primeiro Contato. Janela fechada; não mexe nos da fila.
   */
  /** Aceites antigos do Corujão sem toStatus: marca a entrada em Primeiro Contato (Kanban
   *  mostrava "56 dias nesta etapa" — idade antiga do lead). Idempotente. */
  private async corujaoMarcaEntrada() {
    await this.dataSource.query(
      `UPDATE lead_history SET "toStatus" = 'primeiro_contato'
        WHERE description LIKE 'Repique Corujão: aceito por%' AND "toStatus" IS NULL`
    );
  }

  private async corujaoParaPrimeiroContato() {
    await this.dataSource.query(
      `UPDATE leads SET status = 'primeiro_contato'
        WHERE status = 'novo_lead'
          AND id IN (SELECT "leadId" FROM lead_history
                      WHERE description LIKE 'Repique Corujão: aceito por%'
                        AND "createdAt" < '2026-10-01 17:42:00')`
    );
  }

  /** Registro das planilhas importadas + lote no lead (apagar planilha inteira) — 30/09/2026. */
  private async ensureLeadImports() {
    await this.dataSource.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS "importLote" varchar`);
    await this.dataSource.query(`CREATE INDEX IF NOT EXISTS idx_leads_import_lote ON leads ("importLote")`);
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS lead_imports (
        id varchar PRIMARY KEY,
        nome varchar,
        "userId" varchar,
        "userName" varchar,
        total int NOT NULL DEFAULT 0,
        apagado boolean NOT NULL DEFAULT false,
        "createdAt" timestamp NOT NULL DEFAULT now()
      )`);
  }

  /**
   * Desfaz a planilha do Corujão subida em 30/09/2026 ~18:50 (378 leads com "Força de
   * vendas/Automação" no empreendimento) — o Rodrigo vai subir de novo. Janela FECHADA
   * no tempo (21:00–21:58 UTC): não pega nenhuma importação futura. Sem bloquear telefone.
   */
  private async desfazerImportCorujao3009() {
    const r = await this.dataSource.query(
      `DELETE FROM leads l
        WHERE l.campanha = 'Corujão' AND l.source = 'manual'
          AND l."createdAt" BETWEEN '2026-09-30 21:00:00' AND '2026-09-30 21:58:30'
          AND NOT EXISTS (SELECT 1 FROM lead_history h WHERE h."leadId" = l.id)
          AND NOT EXISTS (SELECT 1 FROM conversations c WHERE c."leadId" = l.id)`
    );
    const n = Array.isArray(r) ? r[1] : r?.affected;
    if (n) this.logger.log(`Importação do Corujão (30/09) desfeita: ${n} lead(s) removido(s).`);
  }

  /**
   * "Cliente sem interesse" (venda_perdida) = do Diretor e sem histórico (30/09/2026).
   * Idempotente: acerta os que já estão lá (e qualquer um que escapou).
   */
  private async arquivarSemInteresse() {
    const d = await this.dataSource.query(
      `SELECT id FROM users WHERE role = 'diretor' AND "empresaId" IS NULL ORDER BY "createdAt" ASC LIMIT 1`
    );
    if (!d.length) return;
    const dir = d[0].id;
    await this.dataSource.query(
      `UPDATE leads SET "responsavelId" = $1 WHERE status = 'venda_perdida' AND ("responsavelId" IS NULL OR "responsavelId" <> $1)`,
      [dir]
    );
    await this.dataSource.query(
      `UPDATE conversations SET "assignedToId" = $1 WHERE "leadId" IN (SELECT id FROM leads WHERE status = 'venda_perdida') AND ("assignedToId" IS NULL OR "assignedToId" <> $1)`,
      [dir]
    );
    await this.dataSource.query(
      `DELETE FROM lead_history WHERE "leadId" IN (SELECT id FROM leads WHERE status = 'venda_perdida')`
    );
  }

  /** Coluna do Kanban só pra gerente pra cima (30/09/2026). 1ª vez: "Arquivos dos TIMES". */
  private async ensureKanbanSomenteGestores() {
    const r = await this.dataSource.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'kanban_columns' AND column_name = 'somenteGestores'`
    );
    if (r.length) return; // já existe: não mexe (o Diretor pode ter desligado)
    await this.dataSource.query(`ALTER TABLE kanban_columns ADD COLUMN IF NOT EXISTS "somenteGestores" boolean NOT NULL DEFAULT false`);
    await this.dataSource.query(`UPDATE kanban_columns SET "somenteGestores" = true WHERE title ILIKE '%arquivo%time%'`);
  }

  /** Telefones de leads EXCLUÍDOS pelo Diretor — não voltam pelo formulário/WhatsApp (29/09/2026). */
  private async ensureLeadsBloqueados() {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS leads_bloqueados (
        phone varchar PRIMARY KEY,
        "createdAt" timestamp NOT NULL DEFAULT now()
      )`);
  }
}
