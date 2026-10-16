import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Cron } from "@nestjs/schedule";
import { Between, IsNull, LessThanOrEqual, Not, Repository } from "typeorm";
import { Client } from "pg";
import { ClienteSaas } from "./cliente-saas.entity";
import { PagamentoSaas } from "./pagamento-saas.entity";
import { SettingsService } from "../settings/settings.service";
import { AiProvider } from "../settings/settings.entity";

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

/** Serviços adicionais vendidos à parte (todos os planos): IA de resposta, IA One, Anúncios Meta. */
export const ADICIONAIS = ["ia", "ione", "meta"];

/** Preços de tabela (R$/mês) — os mesmos da página de vendas e da planilha do John (promo de lançamento). */
export const PRECO_PLANO: Record<string, number> = { Corretor: 49, "Gerente de Vendas": 110, "Gerente Geral": 330, Superintendente: 530, "Diretor completo": 750 };
export const PRECO_ADICIONAL: Record<string, Record<string, number>> = {
  ia: { Corretor: 29, "Gerente de Vendas": 149, "Gerente Geral": 399, Superintendente: 790, "Diretor completo": 1290 },
  ione: { Corretor: 19, "Gerente de Vendas": 59, "Gerente Geral": 99, Superintendente: 199, "Diretor completo": 449 },
  meta: { Corretor: 9, "Gerente de Vendas": 29, "Gerente Geral": 59, Superintendente: 79, "Diretor completo": 99 },
};

/** Quanto o cliente paga por mês: valor negociado, ou plano + adicionais de tabela. */
export function valorDoCliente(c: { plano: string; adicionais: string; valorMensal: number | null }): number | null {
  if (c.valorMensal != null) return c.valorMensal;
  const base = PRECO_PLANO[c.plano];
  if (base == null) return null; // personalizado sem valor negociado
  return (c.adicionais ? c.adicionais.split(",") : []).reduce((t, a) => t + (PRECO_ADICIONAL[a]?.[c.plano] ?? 0), base);
}

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
  // "pendente-..." é o marcador de quem pagou pelo site e ainda não se cadastrou.
  return /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/.test(s) && !RESERVADOS.has(s) && !s.startsWith("pendente-");
}

/**
 * Custos mensais (premissas da planilha do John, docs/simulacao-kayser-one.xlsx) para o lucro
 * do painel: servidor de cada cliente, IA por usuário quando o adicional está ligado, e fixos
 * (infra R$ 300 + marketing R$ 500).
 */
export const CUSTOS = { servidorPorCliente: 40, iaPorUsuario: 4, ionePorUsuario: 1.5, fixoMensal: 800 };

export function custoDoCliente(c: { adicionais: string; limiteUsuarios: number }): number {
  const a = c.adicionais ? c.adicionais.split(",") : [];
  return (
    CUSTOS.servidorPorCliente +
    (a.includes("ia") ? CUSTOS.iaPorUsuario * c.limiteUsuarios : 0) +
    (a.includes("ione") ? CUSTOS.ionePorUsuario * c.limiteUsuarios : 0)
  );
}

/** Desconto de quem paga pela assinatura automática no cartão (Mercado Pago). */
export const DESCONTO_CARTAO = 0.05;

/** Plano de uma assinatura do site pelo valor mensal (49, 110, 330, 530, 750). */
export function planoPeloValor(valor: unknown): string | null {
  return Object.keys(PRECO_PLANO).find((p) => PRECO_PLANO[p] === Number(valor)) ?? null;
}

const REPO = "srodrigo1946-lgtm/kayser-one-backend";
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class ClientesSaasService {
  private readonly logger = new Logger(ClientesSaasService.name);

  constructor(
    @InjectRepository(ClienteSaas) private readonly repo: Repository<ClienteSaas>,
    private readonly settings?: SettingsService,
    @InjectRepository(PagamentoSaas) private readonly pagamentos?: Repository<PagamentoSaas>,
  ) {}

  /** Chave de IA da Kayser (a IA vendida como adicional usa a chave da Kayser; o cliente não vê). */
  private async chaveIaKayser(): Promise<string> {
    if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
    const s = await this.settings?.get();
    return s?.aiProvider === AiProvider.ANTHROPIC && s.aiApiKey ? s.aiApiKey : "";
  }

  /** IA de resposta ou IA One ligada → o servidor do cliente recebe a chave da Kayser; desligada → tira. */
  private async sincronizarChaveIa(c: { railwayServiceId: string | null }, adicionais: string) {
    if (!c.railwayServiceId) return;
    const { projectId, environmentId } = this.config();
    const usaIa = adicionais.split(",").some((a) => a === "ia" || a === "ione");
    const chave = usaIa ? await this.chaveIaKayser() : "";
    const alvo = { projectId, environmentId, serviceId: c.railwayServiceId, name: "ANTHROPIC_API_KEY" };
    if (chave) await this.gql(`mutation($input: VariableUpsertInput!) { variableUpsert(input: $input) }`, { input: { ...alvo, value: chave } });
    else await this.gql(`mutation($input: VariableDeleteInput!) { variableDelete(input: $input) }`, { input: alvo }).catch(() => null);
  }

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
    return this.faltam().length === 0;
  }

  /** Nomes (nunca valores) das chaves que o servidor não está enxergando. */
  faltam() {
    return ["RAILWAY_API_TOKEN", "RAILWAY_CLIENTES_PROJECT_ID", "RAILWAY_CLIENTES_ENV_ID"].filter((k) => !process.env[k]?.trim());
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

  async criar(dto: { empresa: string; subdominio?: string; plano: string; limiteUsuarios?: number; adicionais?: string[]; valorMensal?: number | null; diretorNome: string; diretorEmail: string }) {
    this.config();
    const limite = dto.plano === PLANO_PERSONALIZADO ? Math.floor(Number(dto.limiteUsuarios)) : PLANOS_SAAS[dto.plano];
    if (dto.plano === PLANO_PERSONALIZADO && !(limite >= 1)) throw new BadRequestException("Digite a quantidade de usuários do plano personalizado.");
    if (!limite) throw new BadRequestException("Plano inválido.");
    const sub = slugSubdominio(dto.subdominio || dto.empresa);
    if (!subdominioValido(sub)) throw new BadRequestException(`Subdomínio "${sub}" não pode ser usado. Escolha outro (só letras, números e hífen).`);
    if (await this.repo.findOne({ where: { subdominio: sub } })) throw new BadRequestException(`O subdomínio "${sub}" já é de outro cliente.`);
    const email = dto.diretorEmail.trim().toLowerCase();
    const c = await this.repo.save(
      this.repo.create({ empresa: dto.empresa.trim(), subdominio: sub, plano: dto.plano, limiteUsuarios: limite, adicionais: this.lista(dto.adicionais), valorMensal: dto.valorMensal ?? null, diretorNome: dto.diretorNome.trim(), diretorEmail: email, status: "criando", etapa: "Começando" })
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

  private lista(a?: string[]) {
    return [...new Set((a ?? []).filter((x) => ADICIONAIS.includes(x)))].join(",");
  }

  /** Ajustes do Diretor da Kayser num cliente: adicionais ligados e/ou valor mensal negociado. */
  async ajustar(id: string, a: { adicionais?: string[]; valorMensal?: number | null }) {
    const c = await this.repo.findOne({ where: { id } });
    if (!c) throw new NotFoundException();
    // Valor negociado (null = volta para o preço de tabela).
    if (a.valorMensal !== undefined) await this.repo.update(id, { valorMensal: a.valorMensal });
    return a.adicionais ? this.mudarAdicionais(id, a.adicionais) : { ok: true };
  }

  /** Liga/desliga adicionais de um cliente: grava aqui e no servidor dele (o Railway republica sozinho). */
  async mudarAdicionais(id: string, adicionais: string[]) {
    const { projectId, environmentId } = this.config();
    const c = await this.repo.findOne({ where: { id } });
    if (!c) throw new NotFoundException();
    const valor = this.lista(adicionais);
    await this.repo.update(id, { adicionais: valor });
    // A chave vai antes: a troca de ADICIONAIS logo abaixo é que republica o servidor.
    await this.sincronizarChaveIa(c, valor);
    if (c.railwayServiceId) {
      await this.gql(`mutation($input: VariableUpsertInput!) { variableUpsert(input: $input) }`, {
        input: { projectId, environmentId, serviceId: c.railwayServiceId, name: "ADICIONAIS", value: valor || "nenhum" },
      });
    }
    return { adicionais: valor };
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
      const chaveIa = (c.adicionais || "").split(",").some((x) => x === "ia" || x === "ione") ? await this.chaveIaKayser() : "";
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
            ADICIONAIS: c.adicionais || "nenhum",
            // IA vendida como adicional usa a chave da Kayser (ninguém vê nem digita).
            ...(chaveIa ? { ANTHROPIC_API_KEY: chaveIa } : {}),
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

  // ---------- Cobrança (Mercado Pago, assinatura mensal) ----------

  mercadoPagoConfigurado() {
    return !!process.env.MP_ACCESS_TOKEN;
  }

  private async mp(caminho: string, init: RequestInit = {}) {
    const token = process.env.MP_ACCESS_TOKEN;
    if (!token) throw new ServiceUnavailableException("Falta configurar o Mercado Pago (MP_ACCESS_TOKEN) no Railway da Kayser.");
    const r = await fetch(`https://api.mercadopago.com${caminho}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new BadRequestException(`Mercado Pago: ${j.message || r.status}`);
    return j;
  }

  /**
   * Gera um PLANO de assinatura mensal só deste cliente no Mercado Pago e manda o link pro Diretor.
   * Plano (e não assinatura direta) porque o link de assinatura direta só abre logado com o MESMO
   * e-mail do Diretor no Mercado Pago; o do plano qualquer pessoa paga (conta ou cartão).
   * Quando pagar, o aviso chega com o número do plano (preapproval_plan_id) = cobrancaId.
   */
  async cobrar(id: string) {
    const c = await this.repo.findOne({ where: { id } });
    if (!c) throw new NotFoundException();
    const tabelaOuNegociado = valorDoCliente(c);
    if (!tabelaOuNegociado) throw new BadRequestException("Negocie o valor deste cliente antes de cobrar.");
    // Assinatura no cartão: 5% de desconto sobre a tabela (regra do Rodrigo). Valor negociado vale como está.
    const valor = c.valorMensal != null ? tabelaOuNegociado : Math.round(tabelaOuNegociado * (1 - DESCONTO_CARTAO) * 100) / 100;
    const p = await this.mp("/preapproval_plan", {
      method: "POST",
      body: JSON.stringify({
        reason: `K1 — ${c.empresa} (${c.plano})`,
        back_url: "https://www.kayserone.com.br",
        auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: valor, currency_id: "BRL" },
      }),
    });
    await this.repo.update(id, { cobrancaId: p.id, cobrancaLink: p.init_point, assinatura: "pending" });
    await this.emailCobranca(c, valor, p.init_point);
    return { link: p.init_point, valor };
  }

  /**
   * Aviso do Mercado Pago (público). Não confia no que chega: consulta a assinatura no
   * Mercado Pago e só então atualiza o cliente. Assinatura do site (sem cliente) avisa o Rodrigo.
   */
  async avisoMercadoPago(corpo: any, query: any) {
    const tipo = String(corpo?.type || query?.type || query?.topic || "");
    const id = corpo?.data?.id || query?.["data.id"] || query?.id;
    if (!id || !this.mercadoPagoConfigurado()) return { ok: true };
    if (tipo.includes("authorized_payment")) return this.avisoParcela(String(id));
    if (tipo.includes("payment")) return this.avisoPagamentoPix(String(id));
    if (!tipo.includes("preapproval")) return { ok: true };
    // Assinatura que não existe no Mercado Pago (ex.: "Simular notificação"): ignora e responde 200,
    // senão o Mercado Pago fica reenviando.
    const a = await this.mp(`/preapproval/${encodeURIComponent(String(id))}`).catch(() => null);
    if (!a) return { ok: true };
    const ref = String(a.external_reference || "");
    // Acha o cliente: pela referência, pela assinatura, ou pelo plano exclusivo dele (botão Cobrar).
    const c =
      (/^[0-9a-f-]{36}$/i.test(ref) ? await this.repo.findOne({ where: { id: ref } }) : null) ??
      (await this.repo.findOne({ where: { cobrancaId: String(a.id) } })) ??
      (a.preapproval_plan_id ? await this.repo.findOne({ where: { cobrancaId: String(a.preapproval_plan_id) } }) : null);
    if (c) {
      await this.repo.update(c.id, { assinatura: a.status, cobrancaId: a.id });
      if (a.status !== c.assinatura) await this.avisarRodrigo(`Assinatura ${this.situacao(a.status)} — ${c.empresa}`, `${c.empresa} (${c.plano}): assinatura ${this.situacao(a.status)}.`);
    } else if (a.status === "authorized") {
      // Pagou pelo site e (ainda) não preencheu "Comece seu K1": entra no painel assim mesmo.
      const plano = planoPeloValor(a.auto_recurring?.transaction_amount) ?? "Corretor";
      await this.repo.save(
        this.repo.create({
          empresa: "(falta cadastro)",
          subdominio: `pendente-${String(a.id).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20)}`,
          plano,
          limiteUsuarios: PLANOS_SAAS[plano],
          adicionais: "",
          diretorNome: "",
          diretorEmail: String(a.payer_email || ""),
          status: "aguardando",
          etapa: "Pago pelo site, falta o cadastro",
          origem: "site",
          cobrancaId: String(a.id),
          assinatura: a.status,
        })
      );
      await this.avisarRodrigo(
        `Nova assinatura pelo site — ${a.reason || plano}`,
        `Chegou uma assinatura nova pelo site: ${a.reason || plano}, R$ ${a.auto_recurring?.transaction_amount ?? "?"}/mês.\n` +
          `Se a pessoa não preencher o cadastro, ela aparece no painel Clientes como "Pago, falta cadastro".`
      );
    }
    return { ok: true };
  }

  /**
   * Página pública "Comece seu K1": quem acabou de assinar pelo site preenche os dados
   * e a instalação é criada sozinha. Só vale com assinatura PAGA no Mercado Pago (conferida lá).
   */
  async comecar(dto: { assinatura: string; empresa: string; subdominio?: string; diretorNome: string; diretorEmail: string }) {
    this.config();
    const a = await this.mp(`/preapproval/${encodeURIComponent(dto.assinatura)}`).catch(() => {
      throw new BadRequestException("Não encontrei essa assinatura no Mercado Pago. Abra esta página pelo link que aparece depois de pagar.");
    });
    if (a.status !== "authorized") {
      throw new BadRequestException(
        a.status === "pending"
          ? "O Mercado Pago ainda está confirmando o pagamento. Espere 1 minuto e tente de novo."
          : "Essa assinatura não está ativa no Mercado Pago."
      );
    }
    const plano = planoPeloValor(a.auto_recurring?.transaction_amount);
    if (!plano) throw new BadRequestException("Não reconheci o plano dessa assinatura. Fale com contato@kayserone.com.br.");
    let c = await this.repo.findOne({ where: { cobrancaId: String(a.id) } });
    if (c && c.status !== "aguardando") throw new BadRequestException("Essa assinatura já tem um K1 criado. Veja o e-mail de boas-vindas.");
    const sub = slugSubdominio(dto.subdominio || dto.empresa);
    if (!subdominioValido(sub)) throw new BadRequestException(`O endereço "${sub}" não pode ser usado. Escolha outro (só letras, números e hífen).`);
    const dono = await this.repo.findOne({ where: { subdominio: sub } });
    if (dono && dono.id !== c?.id) throw new BadRequestException(`O endereço "${sub}.kayserone.com.br" já está em uso. Escolha outro.`);
    const dados = {
      empresa: dto.empresa.trim(),
      subdominio: sub,
      plano,
      limiteUsuarios: PLANOS_SAAS[plano],
      diretorNome: dto.diretorNome.trim(),
      diretorEmail: dto.diretorEmail.trim().toLowerCase(),
      status: "criando",
      etapa: "Começando",
      origem: "site",
      cobrancaId: String(a.id),
      assinatura: a.status,
    };
    if (c) await this.repo.update(c.id, dados);
    else c = await this.repo.save(this.repo.create({ ...dados, adicionais: "" }));
    this.provisionar(c.id).catch(() => null);
    await this.avisarRodrigo(
      `Cliente novo pelo site — ${dados.empresa}`,
      `${dados.empresa} (${plano}) assinou pelo site e o K1 dela está sendo criado em https://${sub}.kayserone.com.br.`
    );
    return { ok: true, endereco: `https://${sub}.kayserone.com.br` };
  }

  /**
   * Cobrança avulsa do MÊS (Pix ou cartão) — pra quem não quer assinatura no cartão.
   * O Mercado Pago avisa no mesmo endereço (notification_url) quando o pagamento for aprovado.
   */
  async cobrarPix(id: string) {
    const c = await this.repo.findOne({ where: { id } });
    if (!c) throw new NotFoundException();
    const valor = valorDoCliente(c);
    if (!valor) throw new BadRequestException("Negocie o valor deste cliente antes de cobrar.");
    const p = await this.mp("/checkout/preferences", {
      method: "POST",
      body: JSON.stringify({
        items: [{ title: `K1 — ${c.empresa} (mensalidade)`, quantity: 1, unit_price: valor, currency_id: "BRL" }],
        external_reference: c.id,
        notification_url: `${process.env.PUBLIC_API_URL || "https://kayser-one-backend-production.up.railway.app/api/v1"}/clientes-saas/mercadopago`,
        back_urls: { success: "https://www.kayserone.com.br", failure: "https://www.kayserone.com.br", pending: "https://www.kayserone.com.br" },
      }),
    });
    await this.repo.update(id, { cobrancaLink: p.init_point, assinatura: c.assinatura === "authorized" ? c.assinatura : "pending" });
    await this.email(
      c.diretorEmail,
      `Mensalidade do K1 — ${c.empresa}`,
      `Olá, ${c.diretorNome.split(" ")[0]}!\n\nPara pagar a mensalidade do K1 da ${c.empresa} (Pix ou cartão), use este link do Mercado Pago:\n${p.init_point}\n\n` +
        `Valor: R$ ${valor.toLocaleString("pt-BR")}.\n\nDúvidas: contato@kayserone.com.br\n— Equipe K1`
    );
    return { link: p.init_point, valor };
  }

  /** Pagamento avulso (Pix/cartão) aprovado → marca o mês como pago. Confere no Mercado Pago. */
  private async avisoPagamentoPix(id: string) {
    const pg = await this.mp(`/v1/payments/${encodeURIComponent(id)}`).catch(() => null);
    const ref = String(pg?.external_reference || "");
    if (!pg || pg.status !== "approved" || !/^[0-9a-f-]{36}$/i.test(ref)) return { ok: true };
    const c = await this.repo.findOne({ where: { id: ref } });
    if (!c) return { ok: true };
    await this.repo.update(c.id, { assinatura: "pix_pago", pagoEm: new Date() });
    await this.registrarPagamento(pg, c.id);
    await this.avisarRodrigo(
      `Mensalidade paga — ${c.empresa}`,
      `${c.empresa} pagou R$ ${pg.transaction_amount} (${pg.payment_method_id === "pix" ? "Pix" : pg.payment_method_id}).`
    );
    return { ok: true };
  }

  // ---------- Conta do cliente: bloquear / encerrar (na hora ou numa data) ----------

  /**
   * bloquear: ninguém entra no K1 do cliente (dados guardados).
   * encerrar: bloqueia + cancela a assinatura no Mercado Pago (dados guardados, dá pra reativar).
   * desbloquear: reativa. Com `quando` no futuro, fica agendado (o relógio de hora em hora executa).
   */
  async conta(id: string, acao: string, quando?: string) {
    const c = await this.repo.findOne({ where: { id } });
    if (!c) throw new NotFoundException();
    if (acao === "cancelar_agenda") {
      await this.repo.update(id, { agendaAcao: null, agendaEm: null });
      return { ok: true };
    }
    if (quando && (acao === "bloquear" || acao === "encerrar")) {
      const data = new Date(quando);
      if (isNaN(data.getTime())) throw new BadRequestException("Data inválida.");
      if (data.getTime() > Date.now()) {
        await this.repo.update(id, { agendaAcao: acao, agendaEm: data });
        return { agendado: data };
      }
    }
    await this.aplicarConta(c, acao);
    return { ok: true };
  }

  private async aplicarConta(c: ClienteSaas, acao: string) {
    if (acao === "desbloquear") {
      await this.variavelDoCliente(c, "CONTA_BLOQUEADA", "0");
      await this.repo.update(c.id, { bloqueadoEm: null, encerradoEm: null, agendaAcao: null, agendaEm: null });
      await this.avisarRodrigo(`Conta reativada — ${c.empresa}`, `${c.empresa} foi desbloqueada e voltou a funcionar.`);
      return;
    }
    if (acao === "encerrar" && c.cobrancaId && c.assinatura === "authorized") {
      await this.mp(`/preapproval/${encodeURIComponent(c.cobrancaId)}`, { method: "PUT", body: JSON.stringify({ status: "cancelled" }) }).catch(() => null);
    }
    await this.variavelDoCliente(c, "CONTA_BLOQUEADA", "1");
    const agora = new Date();
    await this.repo.update(c.id, {
      bloqueadoEm: c.bloqueadoEm ?? agora,
      ...(acao === "encerrar" ? { encerradoEm: agora, assinatura: c.assinatura === "authorized" ? "cancelled" : c.assinatura } : {}),
      agendaAcao: null,
      agendaEm: null,
    });
    await this.avisarRodrigo(
      `Conta ${acao === "encerrar" ? "encerrada" : "bloqueada"} — ${c.empresa}`,
      `${c.empresa}: conta ${acao === "encerrar" ? "encerrada (assinatura cancelada)" : "bloqueada"}. Os dados continuam guardados.`
    );
  }

  /**
   * Apaga DE VEZ um cliente encerrado: servidor no Railway, banco dele e o cadastro.
   * Não tem volta — por isso só vale pra conta já encerrada e com o endereço digitado.
   * O histórico de pagamentos (caixa) fica.
   */
  async apagar(id: string, confirmacao: string) {
    const c = await this.repo.findOne({ where: { id } });
    if (!c) throw new NotFoundException();
    if (!c.encerradoEm) throw new BadRequestException("Encerre a conta antes de apagar.");
    if ((confirmacao || "").trim().toLowerCase() !== c.subdominio) throw new BadRequestException(`Digite exatamente "${c.subdominio}" para confirmar.`);
    if (c.railwayServiceId) {
      this.config();
      await this.gql(`mutation($id: String!) { serviceDelete(id: $id) }`, { id: c.railwayServiceId });
    }
    const banco = `kc_${c.subdominio.replace(/-/g, "_")}`;
    if (subdominioValido(c.subdominio)) {
      const db = new Client({ connectionString: await this.pgAdmin(), ssl: { rejectUnauthorized: false } });
      await db.connect();
      try {
        await db.query(`DROP DATABASE IF EXISTS "${banco}" WITH (FORCE)`); // nome vem de subdominioValido (seguro)
      } finally {
        await db.end().catch(() => null);
      }
    }
    await this.repo.delete(id);
    await this.avisarRodrigo(`Cliente apagado — ${c.empresa}`, `${c.empresa} (${c.subdominio}.kayserone.com.br): servidor e banco apagados.`);
    return { ok: true };
  }

  /** Grava uma variável no servidor do cliente (o Railway republica sozinho). */
  private async variavelDoCliente(c: ClienteSaas, name: string, value: string) {
    if (!c.railwayServiceId) return;
    const { projectId, environmentId } = this.config();
    await this.gql(`mutation($input: VariableUpsertInput!) { variableUpsert(input: $input) }`, {
      input: { projectId, environmentId, serviceId: c.railwayServiceId, name, value },
    });
  }

  /** De hora em hora: executa bloqueios/encerramentos marcados pra data. Só na Kayser. */
  @Cron("0 * * * *")
  async executarAgendados() {
    if (!this.configurado()) return;
    const vencidos = await this.repo.find({ where: { agendaAcao: Not(IsNull()), agendaEm: LessThanOrEqual(new Date()) } });
    for (const c of vencidos) {
      await this.aplicarConta(c, c.agendaAcao!).catch((e) => this.logger.error(`Agenda ${c.empresa}: ${(e as Error).message}`));
    }
  }

  // ---------- Caixa e painel do Business K1 ----------

  /** Pagamento aprovado no Mercado Pago entra no caixa (uma vez só por pagamento). */
  private async registrarPagamento(pg: any, clienteId: string | null) {
    if (!this.pagamentos || !pg?.id) return;
    await this.pagamentos
      .createQueryBuilder()
      .insert()
      .values({
        mpId: String(pg.id),
        clienteId,
        valor: Number(pg.transaction_amount) || 0,
        liquido: Number(pg.transaction_details?.net_received_amount ?? pg.transaction_amount) || 0,
        meio: pg.payment_method_id || pg.payment_type_id || null,
        pagoEm: new Date(pg.date_approved || pg.date_created || Date.now()),
      })
      .orIgnore()
      .execute()
      .catch((e) => this.logger.warn(`Caixa: ${(e as Error).message}`));
  }

  /** Parcela da assinatura no cartão (aviso subscription_authorized_payment) → caixa. */
  private async avisoParcela(id: string) {
    const p = await this.mp(`/authorized_payments/${encodeURIComponent(id)}`).catch(() => null);
    const pagamentoId = p?.payment?.id;
    if (!pagamentoId) return { ok: true };
    const pg = await this.mp(`/v1/payments/${encodeURIComponent(String(pagamentoId))}`).catch(() => null);
    if (!pg || pg.status !== "approved") return { ok: true };
    const c = p.preapproval_id ? await this.repo.findOne({ where: { cobrancaId: String(p.preapproval_id) } }) : null;
    await this.registrarPagamento(pg, c?.id ?? null);
    return { ok: true };
  }

  /**
   * Painel do ano: por mês, clientes (ativos, novos, encerrados), receita contratada,
   * caixa (o que entrou de verdade, líquido) e lucro (caixa − custos das premissas do John).
   */
  async painel(ano: number) {
    const clientes = await this.repo.find();
    const pagamentos = this.pagamentos
      ? await this.pagamentos.find({ where: { pagoEm: Between(new Date(ano, 0, 1), new Date(ano + 1, 0, 1)) } })
      : [];
    const agora = new Date();
    const conta = (c: ClienteSaas) => c.status !== "aguardando" && c.status !== "erro";
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const primeiro = clientes.filter(conta).reduce<Date | null>((min, c) => (!min || new Date(c.createdAt) < min ? new Date(c.createdAt) : min), null);
    const inicio = primeiro ? new Date(primeiro.getFullYear(), primeiro.getMonth(), 1) : null;
    const meses = Array.from({ length: 12 }, (_, m) => {
      const ini = new Date(ano, m, 1);
      const fim = new Date(ano, m + 1, 1);
      if (ini > agora) return { mes: m + 1, ativos: 0, novos: 0, encerrados: 0, receita: 0, caixa: 0, custo: 0, lucro: 0, futuro: true };
      const dentro = (d: Date | string | null) => !!d && new Date(d) >= ini && new Date(d) < fim;
      const ativos = clientes.filter((c) => conta(c) && new Date(c.createdAt) < fim && !(c.encerradoEm && new Date(c.encerradoEm) < fim));
      const receita = ativos.reduce((t, c) => t + (valorDoCliente(c) ?? 0), 0);
      const caixa = pagamentos.filter((p) => dentro(p.pagoEm)).reduce((t, p) => t + p.liquido, 0);
      // Fixos só contam a partir do mês do primeiro cliente (antes disso o Business K1 não existia).
      const custo = ativos.reduce((t, c) => t + custoDoCliente(c), 0) + (inicio && ini >= inicio ? CUSTOS.fixoMensal : 0);
      return {
        mes: m + 1,
        ativos: ativos.length,
        novos: clientes.filter((c) => conta(c) && dentro(c.createdAt)).length,
        encerrados: clientes.filter((c) => dentro(c.encerradoEm)).length,
        receita: r2(receita),
        caixa: r2(caixa),
        custo: r2(custo),
        lucro: r2(caixa - custo),
        futuro: false,
      };
    });
    const soma = (k: "novos" | "encerrados" | "receita" | "caixa" | "custo" | "lucro") => r2(meses.reduce((t, x) => t + x[k], 0));
    const ultimo = [...meses].reverse().find((x) => !x.futuro);
    return {
      ano,
      meses,
      total: {
        ativos: ultimo?.ativos ?? 0,
        novos: soma("novos"),
        encerrados: soma("encerrados"),
        receita: soma("receita"),
        caixa: soma("caixa"),
        custo: soma("custo"),
        lucro: soma("lucro"),
      },
      premissas: CUSTOS,
    };
  }

  private situacao(s: string) {
    return ({ authorized: "em dia", pending: "aguardando pagamento", paused: "pausada", cancelled: "cancelada" } as Record<string, string>)[s] || s;
  }

  private async email(para: string, assunto: string, texto: string, copiaRodrigo = true) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return;
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.SUPPORT_FROM || "K1 <onboarding@resend.dev>",
        to: para,
        ...(copiaRodrigo ? { bcc: process.env.SUPPORT_NOTIFY_EMAIL || "srodrigo1946@gmail.com" } : {}),
        subject: assunto,
        text: texto,
      }),
    }).catch((e) => this.logger.warn(`E-mail não enviado: ${(e as Error).message}`));
  }

  private avisarRodrigo(assunto: string, texto: string) {
    return this.email(process.env.SUPPORT_NOTIFY_EMAIL || "srodrigo1946@gmail.com", assunto, texto, false);
  }

  private emailCobranca(c: ClienteSaas, valor: number, link: string) {
    return this.email(
      c.diretorEmail,
      `Assinatura do K1 — ${c.empresa}`,
      `Olá, ${c.diretorNome.split(" ")[0]}!\n\n` +
        `Para ativar a assinatura mensal do K1 da ${c.empresa} (${c.plano}), é só pagar neste link do Mercado Pago:\n${link}\n\n` +
        `Valor: R$ ${valor.toLocaleString("pt-BR")} por mês${c.valorMensal == null ? " (já com 5% de desconto da assinatura no cartão)" : ""}. Dá para cancelar quando quiser.\n\n` +
        `Dúvidas: contato@kayserone.com.br\n— Equipe K1`
    );
  }

  /** E-mail de boas-vindas pro Diretor da imobiliária (cópia pro Rodrigo). */
  private async boasVindas(c: ClienteSaas) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return;
    const link = `https://${c.subdominio}.kayserone.com.br`;
    const texto =
      `Olá, ${c.diretorNome.split(" ")[0]}!\n\n` +
      `O K1 da ${c.empresa} está pronto: ${link}\n\n` +
      `Login: ${c.diretorEmail}\nSenha do primeiro acesso: 123456789 (o sistema pede para criar uma nova)\n` +
      `Plano: ${c.plano} — até ${c.limiteUsuarios} usuário(s).\n\n` +
      `Primeiros passos: em Configurações → Empresa, coloque o nome, a cor e o logo da sua imobiliária; ` +
      `depois cadastre a equipe em Configurações → Usuários.\n\n` +
      `Dúvidas: contato@kayserone.com.br\n— Equipe K1`;
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.SUPPORT_FROM || "K1 <onboarding@resend.dev>",
        to: c.diretorEmail,
        bcc: process.env.SUPPORT_NOTIFY_EMAIL || "srodrigo1946@gmail.com",
        subject: `Seu K1 está pronto — ${c.empresa}`,
        text: texto,
      }),
    }).catch((e) => this.logger.warn(`Boas-vindas não enviado: ${(e as Error).message}`));
  }
}
