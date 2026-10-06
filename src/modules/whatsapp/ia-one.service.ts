import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import Anthropic from "@anthropic-ai/sdk";
import * as bcrypt from "bcryptjs";
import * as XLSX from "xlsx";
import { IaOneMensagem } from "./ia-one-mensagem.entity";
import { User, UserRole } from "../users/user.entity";
import { SettingsService } from "../settings/settings.service";
import { WhatsappService } from "./whatsapp.service";
import { KnowledgeService } from "../knowledge/knowledge.service";
import { PropertiesService } from "../properties/properties.service";
import {
  lerCsv,
  linkCsv,
  lerSimulador,
  lerUnidades,
  lerUnidadesSimulador,
  juntarUnidades,
  unidadesParaCsv,
  lerPromocoes,
  abasDoHtmlview,
  acharPorNome,
  mesesAte,
  simularPagamento,
  textoSimulacao,
  Empreendimento,
  Unidade,
  Tabela,
} from "./ia-one.util";

/** Instância própria da IA One na Evolution (número só da equipe). */
export const IA_ONE_INSTANCIA = "ione";
/** Espera antes de responder, pra juntar mensagens mandadas em sequência. */
export const IA_ONE_ESPERA_MS = 6000;
// Claude Opus 5.5 com esforço "low" (conversa curta de WhatsApp) + fallback do servidor
// se o modelo recusar (rota por categoria, sem lista de modelos pra manter).
const MODELO = "claude-opus-5-5";
const TAG_FOTOS = /\[FOTOS:\s*([^\]]+)\]/gi;
const TAG_CONDICOES = /\[CONDICOES\]/gi;
const TAG_BOOK = /\[BOOK:\s*([^\]]+)\]/gi;

const CARGO: Record<string, string> = {
  diretor: "Diretor",
  superintendente: "Superintendente",
  gerente_geral: "Gerente geral",
  gerente: "Gerente",
  corretor: "Corretor",
};

/** Últimos 8 dígitos do telefone (casa 21 9xxxx-xxxx com ou sem 55/9º dígito). */
const final8 = (t: string) => (t || "").replace(/\D/g, "").slice(-8);

@Injectable()
export class IaOneService {
  private readonly logger = new Logger(IaOneService.name);
  // Últimos envios do número da One (o que a Evolution respondeu) — diagnóstico no painel.
  private envios: { em: string; para: string; status: string; erro?: string }[] = [];

  // Anti-abuso: no máximo 1 reset de senha por usuário por hora pela One.
  private ultimoReset = new Map<string, number>();

  private cache: { em: number; simulador: ReturnType<typeof lerSimulador>; unidades: Unidade[]; promocoes: string[] } | null = null;

  constructor(
    @InjectRepository(IaOneMensagem) private readonly msgs: Repository<IaOneMensagem>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly settings: SettingsService,
    private readonly whatsapp: WhatsappService,
    private readonly knowledge: KnowledgeService,
    private readonly imoveis: PropertiesService
  ) {}

  /* ---------------- dados (planilhas) ---------------- */

  /** Planilha do simulador + tabela de unidades, com cache de 10 min. */
  async dados(forcar = false) {
    if (!forcar && this.cache && Date.now() - this.cache.em < 10 * 60_000) return this.cache;
    const s: any = await this.settings.get();
    const baixar = async (url: string) => {
      const r = await fetch(linkCsv(url), { redirect: "follow" });
      if (!r.ok) throw new Error(`planilha respondeu ${r.status}`);
      return r.text();
    };
    let simulador = { campanha: "", empreendimentos: [] as Empreendimento[] };
    let unidades: Unidade[] = [];
    let promocoes: string[] = [];
    if (s.ionePlanilhaUrl) {
      try {
        const linhas = lerCsv(await baixar(s.ionePlanilhaUrl));
        simulador = lerSimulador(linhas);
        // Tabela completa de unidades (se houver) ou as do empreendimento selecionado no simulador.
        unidades = lerUnidades(linhas);
        if (!unidades.length) unidades = lerUnidadesSimulador(linhas);
      } catch (e) {
        this.logger.warn(`IA One: não li a planilha do simulador (${(e as Error).message}).`);
      }
      // Aba "UNIDADES PROMOCIONAIS" da mesma planilha (acha o gid pelo nome da aba).
      try {
        const id = String(s.ionePlanilhaUrl).match(/spreadsheets\/d\/([\w-]+)/)?.[1];
        if (id) {
          const html = await (await fetch(`https://docs.google.com/spreadsheets/d/${id}/htmlview`)).text();
          const aba = abasDoHtmlview(html).find((a) => /promoc/i.test(a.nome));
          if (aba) promocoes = lerPromocoes(lerCsv(await baixar(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=${aba.gid}`)));
        }
      } catch (e) {
        this.logger.warn(`IA One: não li as unidades promocionais (${(e as Error).message}).`);
      }
    }
    // Arquivos enviados e a planilha de unidades SOMAM às do simulador (por empreendimento).
    if (s.ioneUnidadesCsv) unidades = juntarUnidades(unidades, lerUnidades(lerCsv(s.ioneUnidadesCsv)));
    if (s.ioneUnidadesUrl) {
      try {
        unidades = juntarUnidades(unidades, lerUnidades(lerCsv(await baixar(s.ioneUnidadesUrl))));
      } catch (e) {
        this.logger.warn(`IA One: não li a planilha de unidades (${(e as Error).message}).`);
      }
    }
    this.cache = { em: Date.now(), simulador, unidades, promocoes };
    return this.cache;
  }

  /** Apaga as unidades ENVIADAS de um empreendimento (ex.: planilha que entrou no lugar errado). */
  async removerUnidades(produto: string) {
    const s: any = await this.settings.get();
    const atuais = s.ioneUnidadesCsv ? lerUnidades(lerCsv(s.ioneUnidadesCsv)) : [];
    await this.settings.update({ ioneUnidadesCsv: unidadesParaCsv(atuais.filter((u) => u.produto !== produto)) } as any);
    this.logger.log(`IA One: unidades enviadas de ${produto} apagadas.`);
    return this.resumoDados();
  }

  /**
   * Diretor sobe um arquivo de unidades (Excel ou CSV): a tabela completa (com PRODUTO)
   * ou a lista do simulador de UM empreendimento (sem nome dentro — usa o nome do arquivo,
   * ex.: "ilhamar.xlsx"). Junta com o que já foi enviado.
   */
  async importarUnidades(nomeArquivo: string, base64: string) {
    const buf = Buffer.from(base64.includes(",") ? base64.split(",")[1] : base64, "base64");
    const abas: string[][][] = [];
    if (/\.(xlsx|xls)$/i.test(nomeArquivo)) {
      const wb = XLSX.read(buf, { type: "buffer" });
      for (const n of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[n], { header: 1, raw: true, defval: "" });
        abas.push(rows.map((r) => r.map((v) => (typeof v === "number" ? String(v).replace(".", ",") : String(v ?? "")))));
      }
    } else abas.push(lerCsv(buf.toString("utf8")));

    const { simulador } = await this.dados();
    const base = nomeArquivo.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
    const emp = acharPorNome(simulador.empreendimentos, base, (x) => x.nome);
    let novas: Unidade[] = [];
    for (const linhas of abas) {
      novas = lerUnidades(linhas);
      if (!novas.length) novas = lerUnidadesSimulador(linhas, new Date(), emp?.nome || "");
      if (novas.length) break;
    }
    const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    novas = novas.map((u) => ({ ...u, enviadoEm: hoje }));
    if (!novas.length) {
      throw new BadRequestException(
        emp
          ? "Não achei a tabela de unidades no arquivo (cabeçalho STATUS DA UNIDADE / IDENTIFICADOR ou PRODUTO / UNIDADE / PREÇO)."
          : `Não sei de qual empreendimento é "${nomeArquivo}". Renomeie o arquivo com o nome do empreendimento (ex.: ilhamar.xlsx).`
      );
    }
    const s: any = await this.settings.get();
    const atuais = s.ioneUnidadesCsv ? lerUnidades(lerCsv(s.ioneUnidadesCsv)) : [];
    await this.settings.update({ ioneUnidadesCsv: unidadesParaCsv(juntarUnidades(atuais, novas)) } as any);
    this.logger.log(`IA One: ${novas.length} unidade(s) de ${novas[0].produto} importadas de ${nomeArquivo}.`);
    return { importadas: novas.length, empreendimento: novas[0].produto, ...(await this.resumoDados()) };
  }

  /** Resumo pro painel do Diretor conferir o que a IA One está lendo. */
  async resumoDados() {
    const d = await this.dados(true);
    const porProduto = new Map<string, { qtd: number; min: number; max: number; entrega: string; enviadoEm?: string }>();
    for (const u of d.unidades.filter((x) => /dispon/i.test(x.status))) {
      const p = porProduto.get(u.produto) || { qtd: 0, min: Infinity, max: 0, entrega: u.entrega, enviadoEm: u.enviadoEm };
      p.qtd++;
      if (u.preco) p.min = Math.min(p.min, u.preco);
      p.max = Math.max(p.max, u.preco);
      porProduto.set(u.produto, p);
    }
    return {
      campanha: d.simulador.campanha,
      empreendimentos: d.simulador.empreendimentos,
      unidades: d.unidades.length,
      promocoes: d.promocoes.length,
      disponiveisPorProduto: [...porProduto.entries()].map(([produto, v]) => ({
        produto,
        disponiveis: v.qtd,
        precoMin: v.min === Infinity ? 0 : v.min,
        precoMax: v.max,
        entrega: v.entrega,
        enviadoEm: v.enviadoEm ?? null,
      })),
    };
  }

  /* ---------------- ferramentas da IA ---------------- */

  private async buscarUnidades(a: { empreendimento?: string; tipo?: string; preco_max?: number; unidade?: string }) {
    const { unidades } = await this.dados();
    if (!unidades.length) return { erro: "Tabela de unidades ainda não carregada. Diga que vai confirmar a unidade com o gestor." };
    let lista = unidades.filter((u) => /dispon/i.test(u.status));
    if (a.unidade) {
      const alvo = a.unidade.replace(/\s/g, "").toLowerCase();
      lista = unidades.filter((u) => u.unidade.replace(/\s/g, "").toLowerCase().includes(alvo));
    }
    if (a.empreendimento) {
      const produtos = [...new Set(unidades.map((u) => u.produto))];
      const p = acharPorNome(produtos, a.empreendimento, (x) => x);
      // Não achou: NÃO devolve unidade de outro empreendimento (a planilha só traz as
      // unidades do empreendimento selecionado no simulador).
      if (!p) {
        return {
          erro: `A tabela de unidades não tem o ${a.empreendimento}. Hoje ela só traz: ${produtos.join(", ")}. Diga que vai confirmar a unidade com o gestor.`,
        };
      }
      lista = lista.filter((u) => u.produto === p);
    }
    if (a.tipo) {
      const t = a.tipo.toLowerCase().replace(/\s/g, "");
      lista = lista.filter((u) => u.tipo.toLowerCase().replace(/\s/g, "").includes(t));
    }
    if (a.preco_max) lista = lista.filter((u) => u.preco && u.preco <= a.preco_max!);
    lista.sort((x, y) => x.preco - y.preco);
    return { total: lista.length, unidades: lista.slice(0, 12) };
  }

  private async simular(a: {
    empreendimento?: string;
    unidade?: string;
    valor?: number;
    tabela: Tabela;
    financiamento?: number;
    fgts_subsidio?: number;
  }) {
    const { simulador, unidades } = await this.dados();
    let preco = a.valor || 0;
    let meses = 0;
    let rotulo = a.empreendimento || "";
    if (a.unidade) {
      const alvo = a.unidade.replace(/\s/g, "").toLowerCase();
      const u = unidades.find(
        (x) =>
          x.unidade.replace(/\s/g, "").toLowerCase() === alvo &&
          (!a.empreendimento || x.produto.toLowerCase().includes(a.empreendimento.toLowerCase().split(" ")[0]))
      );
      if (u) {
        preco = preco || u.preco;
        meses = mesesAte(u.entrega);
        rotulo = `${u.produto} ${u.unidade}`;
      }
    }
    const emp = a.empreendimento ? acharPorNome(simulador.empreendimentos, a.empreendimento, (x) => x.nome) : undefined;
    if (emp) {
      if (!preco) preco = emp.valorVenda;
      if (!meses) meses = emp.mesesEntrega;
      if (!rotulo || rotulo === a.empreendimento) rotulo = emp.nome;
    }
    if (!preco) return { erro: "Não achei o valor. Peça o valor da unidade ou o identificador (ex.: BL01-0507)." };
    const sim = (tabela: Tabela) =>
      simularPagamento({ preco, tabela, mesesObra: meses, financiamento: a.financiamento, fgtsSubsidio: a.fgts_subsidio });
    // Tabela direta: manda as 2 regras juntas (pedido do Rodrigo 06/10).
    if (a.tabela === "padrao" || a.tabela === "padrao1") {
      const r1 = sim("padrao1");
      const r2 = sim("padrao");
      return { texto: `${textoSimulacao(r1, rotulo || "unidade")}

${textoSimulacao(r2, rotulo || "unidade")}`, simulacao: [r1, r2] };
    }
    const s = sim(a.tabela);
    return { texto: textoSimulacao(s, rotulo || "unidade"), simulacao: s };
  }

  /**
   * Número que a One não conhece: pede o e-mail do Kayser e, se for de um usuário
   * ativo SEM telefone no cadastro, grava este WhatsApp nele (decisão do Rodrigo 05/10).
   * Se o cadastro já tem outro telefone, não troca (manda falar com o gestor).
   */
  async vincularPorEmail(phone: string, texto: string): Promise<string> {
    const email = (texto.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/) || [])[0]?.toLowerCase();
    if (!email) {
      return "Oi! Eu sou a *One*, assistente da equipe Kayser One. 👋\nNão reconheci este número. Me manda o *e-mail que você usa pra entrar no Kayser One* que eu te identifico.";
    }
    const alvo = (await this.users.find()).find((u) => (u.email || "").trim().toLowerCase() === email);
    if (alvo && alvo.active === false && !alvo.empresaId) {
      return `Achei seu cadastro, ${alvo.name.split(" ")[0]}, mas a sua conta no Kayser One está *desativada* 🔒 Por isso o acesso não funciona. Fale com o seu gestor pra reativar.`;
    }
    if (!alvo || alvo.empresaId) {
      return "Não achei esse e-mail entre os usuários do Kayser One 🤔 Confira o e-mail ou fale com o seu gestor.";
    }
    if (final8(alvo.phone) || final8((alvo as any).whatsapp)) {
      return "Esse e-mail já tem outro telefone no cadastro. Pra usar este número, peça pro seu gestor atualizar o seu telefone no Kayser One. 🙏";
    }
    await this.users.update(alvo.id, { whatsapp: phone, whatsappVinculadoEm: new Date() } as any);
    this.logger.log(`IA One: WhatsApp final ${phone.slice(-4)} vinculado a ${alvo.name} pelo e-mail.`);
    return `Pronto, ${alvo.name.split(" ")[0]}! ✅ Vinculei este WhatsApp ao seu cadastro do Kayser One.\nComo posso te ajudar? (suporte do sistema, empreendimentos, simulação de pagamento…)`;
  }

  /**
   * Reset de senha pedido pelo próprio corretor no WhatsApp da One. Só reseta a conta
   * do TELEFONE que está falando e só se o e-mail informado bater com o cadastro dela.
   * Senha volta pra 123456789 e o sistema pede uma nova no próximo acesso.
   */
  private async resetarSenha(user: User | null, email: string) {
    if (!user) return { erro: "Número não cadastrado: não dá pra resetar." };
    if (user.role === UserRole.DIRETOR) return { erro: "Conta de Diretor não é resetada pela One." };
    if (user.active === false) return { erro: "Conta desativada: precisa falar com o gestor pra reativar." };
    if (user.approved === false) return { erro: "Cadastro ainda aguardando aprovação do gestor (a senha não é o problema)." };
    if ((email || "").trim().toLowerCase() !== (user.email || "").trim().toLowerCase()) {
      return { erro: "O e-mail informado NÃO confere com o cadastro deste telefone. Peça pra conferir o e-mail ou falar com o gestor. Não revele o e-mail cadastrado." };
    }
    const vinculo = (user as any).whatsappVinculadoEm ? new Date((user as any).whatsappVinculadoEm).getTime() : 0;
    if (vinculo && Date.now() - vinculo < 24 * 3600_000) {
      return {
        erro: "Este WhatsApp foi vinculado há menos de 24 h: por segurança o reset de senha só fica liberado depois disso. Até lá, o gestor pode redefinir em Configurações → Equipe.",
      };
    }
    const ultimo = this.ultimoReset.get(user.id) || 0;
    if (Date.now() - ultimo < 60 * 60_000) return { erro: "A senha já foi resetada há menos de 1 hora. Use a 123456789 ou fale com o gestor." };
    await this.users.update(user.id, { passwordHash: await bcrypt.hash("123456789", 12), firstLogin: true } as any);
    this.ultimoReset.set(user.id, Date.now());
    this.logger.log(`IA One: senha de ${user.name} (${user.id}) resetada a pedido pelo WhatsApp.`);
    return { ok: true, senhaProvisoria: "123456789", proximoPasso: "Entrar em kayserone.com.br com o e-mail e a senha 123456789; o sistema pede pra criar a senha nova." };
  }

  /* ---------------- prompt ---------------- */

  private statusConta(u: User | null) {
    if (!u) return "Pessoa NÃO cadastrada.";
    const partes = [
      `${u.name} (${CARGO[u.role] ?? u.role})`,
      u.active === false ? "CONTA DESATIVADA (precisa pedir ao gestor para reativar)" : "conta ativa",
      u.approved === false ? "CADASTRO AGUARDANDO APROVAÇÃO do gestor" : "cadastro aprovado",
      (u as any).firstLogin ? "ainda não fez o primeiro acesso (senha padrão 123456789, vai pedir pra criar a nova)" : "",
      `login: ${u.email}`,
    ];
    return partes.filter(Boolean).join(" · ");
  }

  private async sistema(user: User | null) {
    const s: any = await this.settings.get();
    const d = await this.dados();
    const emps = d.simulador.empreendimentos
      .map(
        (e) =>
          `- ${e.nome} (módulo ${e.modulo}): ${e.valorVenda ? `a partir de R$ ${e.valorVenda.toLocaleString("pt-BR")} · avaliação R$ ${e.avaliacao.toLocaleString("pt-BR")}` : "valor NÃO informado na planilha"} · ${e.estoque} em estoque · ${
            e.mesesEntrega ? `entrega em ${e.mesesEntrega} meses` : "pronto/entregue"
          }`
      )
      .join("\n");
    const books = ((await this.imoveis.findAll().catch(() => [])) as any[])
      .filter((x) => x.active !== false && x.bookKey)
      .map((x) => x.name)
      .join(", ");
    const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "long", year: "numeric" });
    return `Você é a **One**, assistente da equipe comercial do Kayser One (imobiliária/CRM). Fala com CORRETORES e GESTORES pelo WhatsApp — nunca com cliente final.
Hoje é ${hoje}. Responda em português, curto e direto (WhatsApp), com emojis leves. Use *negrito* do WhatsApp quando ajudar.
RESPONDA SEMPRE A ÚLTIMA MENSAGEM, direto ao ponto: "Ilhamar preço" = já mande os preços/unidades do Ilhamar. NÃO comente nem peça desculpas por mensagens anteriores, NÃO repita o menu de opções se a pergunta já está clara. Só pergunte algo se faltar uma informação essencial.

QUEM ESTÁ FALANDO: ${this.statusConta(user)}

O QUE VOCÊ FAZ:
1) SUPORTE do Kayser One (sistema):
- Instalar: abrir kayserone.com.br no celular → "Adicionar à tela inicial".
- Primeiro acesso: senha padrão 123456789; o sistema pede pra criar a senha nova.
- NÃO CONSEGUE ENTRAR / ESQUECEU A SENHA: peça o E-MAIL cadastrado no Kayser One e use a ferramenta resetar_senha com ele. Deu certo → diga pra entrar em kayserone.com.br com o e-mail e a senha 123456789 e criar a senha nova. Deu erro → explique o motivo (sem revelar o e-mail cadastrado). Se a conta estiver aguardando aprovação ou desativada, o problema não é a senha: fale com o gestor.
- Cadastro novo precisa ser APROVADO pelo gestor (sino 🔔). Conta desativada → falar com o gestor.
- Check-in do plantão: automático pelo GPS ao abrir o Kayser no stand; até 500 m do stand; abre 1 h antes e fecha na hora do início do turno (09:00 ok, 09:01 fora). Precisa PERMITIR a localização. GPS demorando → ligar Localização e Wi-Fi, ir pra perto da janela. Não deu → o Diretor vê o motivo no painel e pode liberar.
- Bloqueado no plantão → falar com o gestor (bloqueio do Diretor só o Diretor tira).
- Lead novo: aviso com fogos, 15 min pro primeiro contato, "Atender agora" abre a conversa. Kanban: mover as etapas; "Cliente sem interesse" volta pro Diretor. Corujão: até 20 leads/dia.
2) PRODUTOS E PREÇOS: responda com os dados abaixo e as ferramentas (buscar_unidades traz unidade, status, entrega e preço). NUNCA invente preço, unidade ou data.
3) SIMULAÇÃO DE PAGAMENTO: use SEMPRE a ferramenta simular_pagamento (não faça conta de cabeça) e mande o texto que ela devolver.
   - Tabela direta (tabela "padrao"): a ferramenta devolve as DUAS regras juntas — Regra 1: 10% ato · 20% na obra · 70% pós-obra em 120x; Regra 2: 6% ato · 2% em 30 dias · 2% em 60 dias · 20% na obra · 70% pós-obra em 120x. Mande as duas.
   - Tabela investidor: 10% ato · 90% durante a obra até a entrega.
   - Financiamento Caixa: pergunte o valor aprovado e FGTS/subsídio se o corretor não informou.
4) MATERIAIS: para mandar FOTOS de um empreendimento escreva [FOTOS: Nome do empreendimento] numa linha. Para mandar as CONDIÇÕES DO MÊS (imagem) escreva [CONDICOES]. Para mandar o BOOK (PDF) escreva [BOOK: Nome do empreendimento] — só dos que estão em BOOKS DISPONÍVEIS.
5) NÃO MANDE LINK NENHUM (nem de tabela, planilha, painel ou site): responda direto com a informação. Preço que não estiver nos dados abaixo → diga que vai confirmar com o gestor.

${d.simulador.campanha ? `CAMPANHA / BASE: ${d.simulador.campanha}\n` : ""}EMPREENDIMENTOS (planilha atualizada):
${emps || "(planilha ainda não configurada)"}

UNIDADES PROMOCIONAIS (planilha):
${d.promocoes.join("\n") || "(nenhuma)"}

BOOKS DISPONÍVEIS (PDF): ${books || "(nenhum cadastrado — diga que o book ainda não foi cadastrado)"}

MATERIAIS E INFORMAÇÕES EXTRAS (do Diretor):
${(s.ioneInfo || "").trim() || "(nenhum)"}

REGRAS: você NÃO consegue repassar recado, avisar depois nem falar com gestor/suporte — NUNCA prometa isso ("vou passar pra equipe", "te aviso"). Quando não puder resolver, oriente a pessoa a falar com o gestor dela. Se não souber, diga que não tem essa informação e que o gestor confirma. Se a pessoa NÃO for da equipe, não passe preço nem condição.`;
  }

  /* ---------------- conversa ---------------- */

  /** Gera a resposta da One (com ferramentas). Não envia nada. */
  async responder(user: User | null, phone: string, texto: string) {
    const s: any = await this.settings.get();
    if (!s.ioneClaudeKey) throw new BadRequestException("Chave da Claude da IA One não configurada (aba IA One).");
    const historico = await this.msgs.find({ where: { phone }, order: { createdAt: "DESC" }, take: 12 });
    // Histórico limpo: mensagens seguidas do mesmo lado viram uma só (perguntas juntas;
    // respostas repetidas → fica a última). Senão a IA se perde comentando o passado.
    const messages: any[] = [];
    for (const m of historico.reverse()) {
      const role = m.direction === "in" ? "user" : "assistant";
      const ant = messages[messages.length - 1];
      if (ant && ant.role === role) ant.content = role === "user" ? `${ant.content}\n${m.content}` : m.content;
      else messages.push({ role, content: m.content });
    }
    if (!messages.length || messages[messages.length - 1].role !== "user") messages.push({ role: "user", content: texto });
    // A API exige começar com "user".
    while (messages.length && messages[0].role !== "user") messages.shift();

    const tools = [
      {
        name: "buscar_unidades",
        description: "Busca unidades DISPONÍVEIS na tabela de preços (bloco/unidade, tipo, área, preço, entrega, vaga).",
        input_schema: {
          type: "object",
          properties: {
            empreendimento: { type: "string", description: "Nome do empreendimento" },
            tipo: { type: "string", description: "Ex.: 1Q, 2Q, 3Q" },
            preco_max: { type: "number", description: "Preço máximo em reais" },
            unidade: { type: "string", description: "Identificador, ex.: BL01-0507" },
          },
        },
      },
      {
        name: "resetar_senha",
        description: "Reseta a senha do Kayser One de QUEM ESTÁ FALANDO pra 123456789, se o e-mail informado bater com o cadastro. Use quando não conseguir entrar ou esqueceu a senha.",
        input_schema: {
          type: "object",
          properties: { email: { type: "string", description: "E-mail cadastrado no Kayser One, informado pelo corretor" } },
          required: ["email"],
        },
      },
      {
        name: "simular_pagamento",
        description: "Simula o fluxo de pagamento. Use sempre que pedirem simulação/fluxo/parcelas.",
        input_schema: {
          type: "object",
          properties: {
            empreendimento: { type: "string" },
            unidade: { type: "string", description: "Identificador da unidade, se houver" },
            valor: { type: "number", description: "Valor da unidade em reais, se informado" },
            tabela: { type: "string", enum: ["padrao", "investidor", "caixa"], description: "padrao = tabela direta (devolve as 2 regras juntas)" },
            financiamento: { type: "number", description: "Valor aprovado na Caixa (só tabela caixa)" },
            fgts_subsidio: { type: "number", description: "FGTS + subsídio (só tabela caixa)" },
          },
          required: ["tabela"],
        },
      },
    ];

    const client = new Anthropic({ apiKey: s.ioneClaudeKey });
    const system = await this.sistema(user);
    for (let volta = 0; volta < 5; volta++) {
      const resp: any = await client.beta.messages.create({
        model: MODELO,
        max_tokens: 16000,
        system,
        messages,
        tools,
        output_config: { effort: "low" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      } as any);
      if (resp.stop_reason === "refusal") {
        this.logger.warn(`IA One: recusa (${resp.stop_details?.category ?? "sem categoria"}).`);
        return "Essa eu não consigo responder por aqui 🙏 Fale com o seu gestor.";
      }
      const usos = (resp.content as any[]).filter((b) => b.type === "tool_use");
      if (!usos.length || resp.stop_reason !== "tool_use") {
        return (resp.content as any[])
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("")
          .trim();
      }
      messages.push({ role: "assistant", content: resp.content });
      const resultados = [];
      for (const u of usos) {
        let r: any;
        try {
          r =
            u.name === "buscar_unidades"
              ? await this.buscarUnidades(u.input)
              : u.name === "resetar_senha"
              ? await this.resetarSenha(user, u.input?.email)
              : await this.simular(u.input);
        } catch (e) {
          r = { erro: (e as Error).message };
        }
        resultados.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(r).slice(0, 12000) });
      }
      messages.push({ role: "user", content: resultados });
    }
    return "Não consegui fechar essa resposta agora 🙏 Confirme com o seu gestor.";
  }

  /** Separa as marcações [FOTOS: x], [BOOK: x] e [CONDICOES] do texto. */
  separar(texto: string) {
    const fotos = [...texto.matchAll(TAG_FOTOS)].map((m) => m[1].trim());
    const books = [...texto.matchAll(TAG_BOOK)].map((m) => m[1].trim());
    const condicoes = /\[CONDICOES\]/i.test(texto); // sem /g: .test com /g guarda posição entre chamadas
    const limpo = texto.replace(TAG_FOTOS, "").replace(TAG_CONDICOES, "").replace(TAG_BOOK, "").replace(/\n{3,}/g, "\n\n").trim();
    return { limpo, fotos: [...new Set(fotos)].slice(0, 2), condicoes, books: [...new Set(books)].slice(0, 2) };
  }

  private async acharUsuario(phone: string): Promise<User | null> {
    const alvo = final8(phone);
    if (alvo.length < 8) return null;
    const todos = await this.users.find();
    return todos.find((u) => final8(u.phone) === alvo || final8((u as any).whatsapp) === alvo) || null;
  }

  private async transcrever(base64: string, mime: string): Promise<string | null> {
    const s: any = await this.settings.get();
    if (!s.ioneOpenaiKey) return null;
    try {
      const tipo = (mime || "audio/ogg").split(";")[0].trim() || "audio/ogg";
      const form = new FormData();
      form.append("file", new Blob([Buffer.from(base64, "base64")], { type: tipo }), `audio.${tipo.includes("mpeg") ? "mp3" : "ogg"}`);
      form.append("model", "whisper-1");
      form.append("language", "pt");
      const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${s.ioneOpenaiKey}` },
        body: form,
      });
      if (!r.ok) return null;
      return (((await r.json()) as any)?.text || "").trim() || null;
    } catch {
      return null;
    }
  }

  private async salvar(phone: string, user: User | null, nome: string, direction: "in" | "out", content: string) {
    await this.msgs.save(this.msgs.create({ phone, userId: user?.id ?? null, nome: user?.name ?? nome ?? null, direction, content })).catch(() => {});
  }

  /** Mensagem que chegou no número da IA One. */
  async receber(payload: any, p: { remoteJid: string; isGroup: boolean; text: string; mediaType: string | null; fromMe: boolean; pushName: string }) {
    if (p.fromMe || p.isGroup) return { ignored: true };
    const s: any = await this.settings.get();
    if (s.ioneAtivo === false) return { ignored: true, motivo: "IA One desligada" };
    const raw = Array.isArray(payload?.data) ? payload.data[0] : payload?.data ?? payload;
    // WhatsApp novo pode esconder o número (@lid): tenta o número real que vem junto.
    const alt = raw?.key?.senderPn || raw?.key?.remoteJidAlt || "";
    const phone = (/@lid/.test(raw?.key?.remoteJid || "") && alt ? alt : p.remoteJid).split("@")[0].replace(/\D/g, "");
    const user = await this.acharUsuario(phone);

    let texto = p.text;
    if (p.mediaType === "audio") {
      const dl = await this.whatsapp.getMediaBase64(IA_ONE_INSTANCIA, raw);
      const t = dl ? await this.transcrever(dl.base64, dl.mimetype) : null;
      texto = t ? `🎤 ${t}` : "";
      if (!texto) {
        await this.enviar(phone, "Não consegui ouvir o áudio agora 🙏 Pode mandar por escrito?", user, p.pushName);
        return { ok: true };
      }
    }
    await this.salvar(phone, user, p.pushName, "in", texto);

    // Mensagens seguidas ("Tabela direta" + "Ato de 10%"): espera um pouco e só a ÚLTIMA
    // responde — com o histórico todo, uma resposta só (antes saíam duas).
    await new Promise((r) => setTimeout(r, IA_ONE_ESPERA_MS));
    const ultima = await this.msgs.findOne({ where: { phone }, order: { createdAt: "DESC" } });
    if (ultima && ultima.direction === "in" && ultima.content !== texto) return { ok: true, agrupada: true };

    if (!user) {
      await this.enviar(phone, await this.vincularPorEmail(phone, texto), null, p.pushName);
      return { ok: true };
    }
    if (user.active === false) {
      await this.enviar(phone, "Oi! Sua conta no Kayser One está desativada. Fale com o seu gestor pra reativar. 🙏", user, p.pushName);
      return { ok: true };
    }

    try {
      const bruto = await this.responder(user, phone, texto);
      const { limpo, fotos, condicoes, books } = this.separar(bruto);
      if (limpo) await this.enviar(phone, limpo, user, p.pushName);
      for (const nome of fotos) {
        const f = await this.knowledge.fotosDoEmpreendimento(nome, 5).catch(() => null);
        for (const foto of f?.fotos ?? []) await this.whatsapp.sendMedia(IA_ONE_INSTANCIA, phone, foto).catch(() => {});
        if (f?.fotos?.length) await this.salvar(phone, user, p.pushName, "out", `📷 ${f.fotos.length} foto(s) do ${f.nome}`);
      }
      for (const nome of books) {
        const comBook = ((await this.imoveis.findAll().catch(() => [])) as any[]).filter((x) => x.active !== false && x.bookKey);
        const imovel = acharPorNome(comBook, nome, (x) => x.name);
        const pdf = imovel ? await this.imoveis.getBook(imovel.id).catch(() => null) : null;
        if (pdf) {
          await this.whatsapp
            .sendMedia(IA_ONE_INSTANCIA, phone, { base64: pdf.buffer.toString("base64"), mimetype: "application/pdf", fileName: pdf.nome, caption: `Book ${imovel.name}` })
            .catch(() => {});
          await this.salvar(phone, user, p.pushName, "out", `📘 Book ${imovel.name} (PDF)`);
        }
      }
      if (condicoes) {
        const img = await this.settings.getDirecionalImageData().catch(() => null);
        if (img) {
          await this.whatsapp
            .sendMedia(IA_ONE_INSTANCIA, phone, { base64: img.buffer.toString("base64"), mimetype: img.contentType, fileName: "condicoes-do-mes", caption: "Condições do mês" })
            .catch(() => {});
          await this.salvar(phone, user, p.pushName, "out", "🖼️ Condições do mês");
        }
      }
    } catch (e) {
      this.logger.error(`IA One falhou: ${(e as Error).message}`);
      await this.enviar(phone, "Tive um probleminha pra responder agora 😅 Tenta de novo em instantes ou fale com o seu gestor.", user, p.pushName);
    }
    return { ok: true };
  }

  private async enviar(phone: string, texto: string, user: User | null, nome: string) {
    try {
      const r: any = await this.whatsapp.sendText(IA_ONE_INSTANCIA, phone, texto);
      this.registrarEnvio(phone, r?.key?.remoteJid || "?", String(r?.status ?? r?.message?.status ?? "enviado"));
    } catch (e) {
      this.registrarEnvio(phone, "-", "FALHOU", (e as Error).message);
      throw e;
    }
    await this.salvar(phone, user, nome, "out", texto);
  }

  private registrarEnvio(phone: string, para: string, status: string, erro?: string) {
    this.envios.unshift({ em: new Date().toISOString(), para: `${phone.slice(-4)} → ${para}`, status, ...(erro ? { erro: erro.slice(0, 200) } : {}) });
    this.envios = this.envios.slice(0, 20);
  }

  ultimosEnvios() {
    return this.envios;
  }

  async reiniciar() {
    await this.whatsapp.restartInstance(IA_ONE_INSTANCIA);
    await this.whatsapp.ensureWebhook(IA_ONE_INSTANCIA).catch(() => null);
    return this.status();
  }

  /* ---------------- painel do Diretor ---------------- */

  async conversas() {
    const rows = await this.msgs.query(
      `SELECT DISTINCT ON (phone) phone, nome, content, direction, "createdAt",
              (SELECT count(*) FROM ia_one_mensagens m2 WHERE m2.phone = m.phone)::int AS total
         FROM ia_one_mensagens m ORDER BY phone, "createdAt" DESC`
    );
    return rows.sort((a: any, b: any) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }

  mensagens(phone: string) {
    return this.msgs.find({ where: { phone }, order: { createdAt: "ASC" }, take: 200 });
  }

  /** Testar pelo painel (sem WhatsApp): responde como se fosse o Diretor falando. */
  async testar(diretor: User, texto: string) {
    const bruto = await this.responder(diretor, `teste-${diretor.id}`, texto);
    return this.separar(bruto);
  }

  async status() {
    try {
      return await this.whatsapp.getInstanceStatus(IA_ONE_INSTANCIA);
    } catch {
      return { state: "close" };
    }
  }

  async conectar(reset = false) {
    if (reset) await this.whatsapp.deleteInstance(IA_ONE_INSTANCIA).catch(() => {});
    await this.whatsapp.createInstance(IA_ONE_INSTANCIA);
    return this.whatsapp.getQrCode(IA_ONE_INSTANCIA);
  }

  async desconectar() {
    await this.whatsapp.deleteInstance(IA_ONE_INSTANCIA);
    return { ok: true };
  }
}

export type { UserRole };
