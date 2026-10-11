import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Client } from "pg";
import { ClienteSaas } from "./cliente-saas.entity";

/** Planos à venda (página de vendas) → usuários permitidos (LIMITE_USUARIOS). */
export const PLANOS_SAAS: Record<string, number> = {
  "Corretor": 1,
  "Gerente de Vendas": 16,
  "Gerente Geral": 57,
  "Superintendente": 120,
  "Diretor completo": 250,
};

/** Acima de 250 (negociado na reunião com o CEO): o Diretor digita a quantidade de usuários. */
export const PLANO_PERSONALIZADO = "Personalizado (CEO)";

/** Subdomínios que não podem ser de cliente. */
const RESERVADOS = new Set(["www", "demo", "api", "app", "admin", "mail", "email", "rsend", "enviar", "send", "kayser", "kayserone", "suporte", "contato", "teste"]);

/** "Imobiliária São João Ltda" → "imobiliariasaojoao" (só letras, números e hífen). */
export function slugSubdominio(texto: string): string {
  return (texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(ltda|me|eireli|s\/?a)\b/g, "")
    .replace(/[^a-z0-9-]+/g, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

export function subdominioValido(s: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/.test(s) && !RESERVADOS.has(s);
}

const REPO = "srodrigo1946-lgtm/kayser-one-backend";
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class ClientesSaasService {
  private readonly logger = new Logger(ClientesSaasService.name);

  constructor(@InjectRepository(ClienteSaas) private readonly repo: Repository<ClienteSaas>) {}

  /** Só a instalação da Kayser tem as chaves do Railway; nas outras, tudo isso fica desligado. */
  private config() {
    const token = process.env.RAILWAY_API_TOKEN;
    const projectId = process.env.RAILWAY_CLIENTES_PROJECT_ID;
    const environmentId = process.env.RAILWAY_CLIENTES_ENV_ID;
    if (!token || !projectId || !environmentId) {
      throw new ServiceUnavailableException("Criação automática de clientes ainda não configurada (faltam as chaves do Railway).");
    }
    return { token, projectId, environmentId };
  }

  /** Endereço do Postgres dos clientes: CLIENTES_PG_URL ou, se não tiver, busca no Railway pelo token. */
  private async pgAdmin(): Promise<string> {
    if (process.env.CLIENTES_PG_URL) return process.env.CLIENTES_PG_URL;
    const { projectId, environmentId } = this.config();
    const p = await this.gql(`query($id: String!) { project(id: $id) { services { edges { node { id name } } } } }`, { id: projectId });
    const pg = p.project.services.edges.map((e: any) => e.node).find((n: any) => /postgres/i.test(n.name));
    if (!pg) throw new Error("Não achei o Postgres no projeto dos clientes.");
    const v = await this.gql(`query($p: String!, $e: String!, $s: String!) { variables(projectId: $p, environmentId: $e, serviceId: $s) }`, { p: projectId, e: environmentId, s: pg.id });
    const url = v.variables?.DATABASE_PUBLIC_URL;
    if (!url) throw new Error("O Postgres dos clientes está sem acesso público (ligar TCP Proxy no Railway).");
    return url;
  }

  configurado() {
    return !!(process.env.RAILWAY_API_TOKEN && process.env.RAILWAY_CLIENTES_PROJECT_ID && process.env.RAILWAY_CLIENTES_ENV_ID);
  }

  listar() {
    return this.repo.find({ order: { createdAt: "DESC" } });
  }

  /** Público (Worker do Cloudflare): para onde aponta o subdomínio. */
  async destino(sub: string) {
    const c = await this.repo.findOne({ where: { subdominio: (sub || "").toLowerCase() } });
    if (!c?.apiUrl) throw new NotFoundException();
    return { api: c.apiUrl };
  }

  async criar(dto: { empresa: string; subdominio?: string; plano: string; limiteUsuarios?: number; diretorNome: string; diretorEmail: string }) {
    this.config();
    const limite = dto.plano === PLANO_PERSONALIZADO ? Math.floor(Number(dto.limiteUsuarios)) : PLANOS_SAAS[dto.plano];
    if (dto.plano === PLANO_PERSONALIZADO && !(limite >= 1)) throw new BadRequestException("Digite a quantidade de usuários do plano personalizado.");
    if (!limite) throw new BadRequestException("Plano inválido.");
    const sub = slugSubdominio(dto.subdominio || dto.empresa);
    if (!subdominioValido(sub)) throw new BadRequestException(`Subdomínio "${sub}" não pode ser usado. Escolha outro (só letras, números e hífen).`);
    if (await this.repo.findOne({ where: { subdominio: sub } })) throw new BadRequestException(`O subdomínio "${sub}" já é de outro cliente.`);
    const email = dto.diretorEmail.trim().toLowerCase();
    const c = await this.repo.save(
      this.repo.create({ empresa: dto.empresa.trim(), subdominio: sub, plano: dto.plano, limiteUsuarios: limite, diretorNome: dto.diretorNome.trim(), diretorEmail: email, status: "criando", etapa: "Começando" })
    );
    // Leva alguns minutos (build no Railway): roda em segundo plano e a tela acompanha pelo status.
    this.provisionar(c.id).catch(() => null);
    return c;
  }

  /** Tenta de novo um cliente que deu erro (continua de onde parou). */
  async tentarDeNovo(id: string) {
    this.config();
    const c = await this.repo.findOne({ where: { id } });
    if (!c) throw new NotFoundException();
    await this.repo.update(id, { status: "criando", erro: null, etapa: "Tentando de novo" });
    this.provisionar(id).catch(() => null);
    return { ok: true };
  }

  private async etapa(id: string, etapa: string, extra: Partial<ClienteSaas> = {}) {
    await this.repo.update(id, { etapa, ...extra } as any);
    this.logger.log(`Cliente ${id}: ${etapa}`);
  }

  private async gql<T = any>(query: string, variables: Record<string, unknown>): Promise<T> {
    const { token } = this.config();
    const r = await fetch("https://backboard.railway.com/graphql/v2", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok || j.errors?.length) throw new Error(`Railway: ${j.errors?.[0]?.message || r.status}`);
    return j.data as T;
  }

  /** Banco do cliente dentro do Postgres compartilhado dos clientes (um banco por imobiliária). */
  private async criarBanco(nome: string) {
    const db = new Client({ connectionString: await this.pgAdmin(), ssl: { rejectUnauthorized: false } });
    await db.connect();
    try {
      const existe = await db.query("SELECT 1 FROM pg_database WHERE datname = $1", [nome]);
      if (!existe.rowCount) await db.query(`CREATE DATABASE "${nome}"`); // nome vem de subdominioValido (seguro)
    } finally {
      await db.end().catch(() => null);
    }
  }

  async provisionar(id: string) {
    const { projectId, environmentId } = this.config();
    const c = await this.repo.findOne({ where: { id } });
    if (!c) return;
    const banco = `kc_${c.subdominio.replace(/-/g, "_")}`;
    try {
      await this.etapa(id, "Criando o banco de dados");
      await this.criarBanco(banco);

      let serviceId = c.railwayServiceId;
      if (!serviceId) {
        await this.etapa(id, "Criando o servidor no Railway");
        const d = await this.gql<{ serviceCreate: { id: string } }>(
          `mutation($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }`,
          { input: { projectId, name: `kayser-${c.subdominio}`, source: { repo: REPO }, branch: "main" } }
        );
        serviceId = d.serviceCreate.id;
        await this.repo.update(id, { railwayServiceId: serviceId });
      }

      await this.etapa(id, "Configurando (plano, Diretor, banco)");
      await this.gql(`mutation($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }`, {
        input: {
          projectId,
          environmentId,
          serviceId,
          skipDeploys: true,
          variables: {
            // Senha e endereço do banco por referência do Railway (ninguém vê/digita segredo).
            DATABASE_URL: `postgresql://\${{Postgres.PGUSER}}:\${{Postgres.PGPASSWORD}}@\${{Postgres.PGHOST}}:\${{Postgres.PGPORT}}/${banco}`,
            NODE_ENV: "production",
            JWT_SECRET: "${{secret(64)}}",
            WHATSAPP_WEBHOOK_TOKEN: "${{secret(32)}}",
            SEED_DIRETOR_EMAIL: c.diretorEmail,
            SEED_DIRETOR_NAME: c.diretorNome,
            LIMITE_USUARIOS: String(c.limiteUsuarios),
            FRONTEND_URL: `https://${c.subdominio}.kayserone.com.br`,
          },
        },
      });

      let apiUrl = c.apiUrl;
      if (!apiUrl) {
        await this.etapa(id, "Gerando o endereço do servidor");
        const d = await this.gql<{ serviceDomainCreate: { domain: string } }>(
          `mutation($input: ServiceDomainCreateInput!) { serviceDomainCreate(input: $input) { domain } }`,
          { input: { serviceId, environmentId } }
        );
        apiUrl = `https://${d.serviceDomainCreate.domain}/api/v1`;
        await this.repo.update(id, { apiUrl });
      }

      await this.etapa(id, "Publicando (leva uns minutos)");
      await this.gql(`mutation($s: String!, $e: String!) { serviceInstanceDeployV2(serviceId: $s, environmentId: $e) }`, { s: serviceId, e: environmentId });

      // Espera o servidor responder (build + primeira subida), até ~20 min.
      for (let i = 0; i < 60; i++) {
        await dormir(20_000);
        const ok = await fetch(`${apiUrl}/marca`).then((r) => r.ok).catch(() => false);
        if (ok) {
          await this.etapa(id, "Pronto", { status: "ativo", erro: null });
          await this.boasVindas({ ...c, apiUrl });
          return;
        }
      }
      throw new Error("O servidor não respondeu em 20 minutos (veja o deploy no Railway).");
    } catch (e) {
      const msg = (e as Error).message || String(e);
      this.logger.error(`Cliente ${c.subdominio}: ${msg}`);
      await this.repo.update(id, { status: "erro", erro: msg.slice(0, 500) });
    }
  }

  /** E-mail de boas-vindas pro Diretor da imobiliária (cópia pro Rodrigo). */
  private async boasVindas(c: ClienteSaas) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return;
    const link = `https://${c.subdominio}.kayserone.com.br`;
    const texto =
      `Olá, ${c.diretorNome.split(" ")[0]}!\n\n` +
      `O Kayser One da ${c.empresa} está pronto: ${link}\n\n` +
      `Login: ${c.diretorEmail}\nSenha do primeiro acesso: 123456789 (o sistema pede para criar uma nova)\n` +
      `Plano: ${c.plano} — até ${c.limiteUsuarios} usuário(s).\n\n` +
      `Primeiros passos: em Configurações → Empresa, coloque o nome, a cor e o logo da sua imobiliária; ` +
      `depois cadastre a equipe em Configurações → Usuários.\n\n` +
      `Dúvidas: contato@kayserone.com.br\n— Equipe Kayser One`;
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.SUPPORT_FROM || "Kayser One <onboarding@resend.dev>",
        to: c.diretorEmail,
        bcc: process.env.SUPPORT_NOTIFY_EMAIL || "srodrigo1946@gmail.com",
        subject: `Seu Kayser One está pronto — ${c.empresa}`,
        text: texto,
      }),
    }).catch((e) => this.logger.warn(`Boas-vindas não enviado: ${(e as Error).message}`));
  }
}
