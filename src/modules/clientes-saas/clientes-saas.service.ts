import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Client } from "pg";
import { ClienteSaas } from "./cliente-saas.entity";
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

  async criar(dto: { empresa: string; subdominio?: string; plano: string; limiteUsuarios?: number; adicionais?: string[]; diretorNome: string; diretorEmail: string }) {
    this.config();
    const limite = dto.plano === PLANO_PERSONALIZADO ? Math.floor(Number(dto.limiteUsuarios)) : PLANOS_SAAS[dto.plano];
    if (dto.plano === PLANO_PERSONALIZADO && !(limite >= 1)) throw new BadRequestException("Digite a quantidade de usuários do plano personalizado.");
    if (!limite) throw new BadRequestException("Plano inválido.");
    const sub = slugSubdominio(dto.subdominio || dto.empresa);
    if (!subdominioValido(sub)) throw new BadRequestException(`Subdomínio "${sub}" não pode ser usado. Escolha outro (só letras, números e hífen).`);
    if (await this.repo.findOne({ where: { subdominio: sub } })) throw new BadRequestException(`O subdomínio "${sub}" já é de outro cliente.`);
    const email = dto.diretorEmail.trim().toLowerCase();
    const c = await this.repo.save(
      this.repo.create({ empresa: dto.empresa.trim(), subdominio: sub, plano: dto.plano, limiteUsuarios: limite, adicionais: this.lista(dto.adicionais), diretorNome: dto.diretorNome.trim(), diretorEmail: email, status: "criando", etapa: "Começando" })
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

  /** Gera a assinatura mensal do cliente no Mercado Pago e manda o link pro Diretor dele. */
  async cobrar(id: string) {
    const c = await this.repo.findOne({ where: { id } });
    if (!c) throw new NotFoundException();
    const valor = valorDoCliente(c);
    if (!valor) throw new BadRequestException("Negocie o valor deste cliente antes de cobrar.");
    const a = await this.mp("/preapproval", {
      method: "POST",
      body: JSON.stringify({
        reason: `Kayser One — ${c.empresa} (${c.plano})`,
        external_reference: c.id,
        payer_email: c.diretorEmail,
        back_url: "https://www.kayserone.com.br",
        status: "pending",
        auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: valor, currency_id: "BRL" },
      }),
    });
    await this.repo.update(id, { cobrancaId: a.id, cobrancaLink: a.init_point, assinatura: a.status || "pending" });
    await this.emailCobranca(c, valor, a.init_point);
    return { link: a.init_point, valor };
  }

  /**
   * Aviso do Mercado Pago (público). Não confia no que chega: consulta a assinatura no
   * Mercado Pago e só então atualiza o cliente. Assinatura do site (sem cliente) avisa o Rodrigo.
   */
  async avisoMercadoPago(corpo: any, query: any) {
    const tipo = String(corpo?.type || query?.type || query?.topic || "");
    const id = corpo?.data?.id || query?.["data.id"] || query?.id;
    if (!id || !tipo.includes("preapproval") || !this.mercadoPagoConfigurado()) return { ok: true };
    const a = await this.mp(`/preapproval/${encodeURIComponent(String(id))}`);
    const ref = String(a.external_reference || "");
    const c =
      (/^[0-9a-f-]{36}$/i.test(ref) ? await this.repo.findOne({ where: { id: ref } }) : null) ??
      (await this.repo.findOne({ where: { cobrancaId: String(a.id) } }));
    if (c) {
      await this.repo.update(c.id, { assinatura: a.status, cobrancaId: a.id });
      if (a.status !== c.assinatura) await this.avisarRodrigo(`Assinatura ${this.situacao(a.status)} — ${c.empresa}`, `${c.empresa} (${c.plano}): assinatura ${this.situacao(a.status)}.`);
    } else if (a.status === "authorized") {
      // Pagou pelo site e (ainda) não preencheu "Comece seu Kayser One": entra no painel assim mesmo.
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
   * Página pública "Comece seu Kayser One": quem acabou de assinar pelo site preenche os dados
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
    if (c && c.status !== "aguardando") throw new BadRequestException("Essa assinatura já tem um Kayser One criado. Veja o e-mail de boas-vindas.");
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
      `${dados.empresa} (${plano}) assinou pelo site e o Kayser One dela está sendo criado em https://${sub}.kayserone.com.br.`
    );
    return { ok: true, endereco: `https://${sub}.kayserone.com.br` };
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
        from: process.env.SUPPORT_FROM || "Kayser One <onboarding@resend.dev>",
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
      `Assinatura do Kayser One — ${c.empresa}`,
      `Olá, ${c.diretorNome.split(" ")[0]}!\n\n` +
        `Para ativar a assinatura mensal do Kayser One da ${c.empresa} (${c.plano}), é só pagar neste link do Mercado Pago:\n${link}\n\n` +
        `Valor: R$ ${valor.toLocaleString("pt-BR")} por mês. Dá para cancelar quando quiser.\n\n` +
        `Dúvidas: contato@kayserone.com.br\n— Equipe Kayser One`
    );
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
