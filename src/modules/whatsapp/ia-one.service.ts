import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import Anthropic from "@anthropic-ai/sdk";
import { IaOneMensagem } from "./ia-one-mensagem.entity";
import { User, UserRole } from "../users/user.entity";
import { SettingsService } from "../settings/settings.service";
import { WhatsappService } from "./whatsapp.service";
import { KnowledgeService } from "../knowledge/knowledge.service";
import {
  lerCsv,
  linkCsv,
  lerSimulador,
  lerUnidades,
  lerUnidadesSimulador,
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
// Claude Opus 5.5 com esforço "low" (conversa curta de WhatsApp) + fallback do servidor
// se o modelo recusar (rota por categoria, sem lista de modelos pra manter).
const MODELO = "claude-opus-5-5";
const TAG_FOTOS = /\[FOTOS:\s*([^\]]+)\]/gi;
const TAG_CONDICOES = /\[CONDICOES\]/gi;

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
  private cache: { em: number; simulador: ReturnType<typeof lerSimulador>; unidades: Unidade[]; promocoes: string[] } | null = null;

  constructor(
    @InjectRepository(IaOneMensagem) private readonly msgs: Repository<IaOneMensagem>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly settings: SettingsService,
    private readonly whatsapp: WhatsappService,
    private readonly knowledge: KnowledgeService
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
    if (s.ioneUnidadesUrl) {
      try {
        const u = lerUnidades(lerCsv(await baixar(s.ioneUnidadesUrl)));
        if (u.length) unidades = u;
      } catch (e) {
        this.logger.warn(`IA One: não li a planilha de unidades (${(e as Error).message}).`);
      }
    } else if (s.ioneUnidadesCsv) {
      const u = lerUnidades(lerCsv(s.ioneUnidadesCsv));
      if (u.length) unidades = u;
    }
    this.cache = { em: Date.now(), simulador, unidades, promocoes };
    return this.cache;
  }

  /** Resumo pro painel do Diretor conferir o que a IA One está lendo. */
  async resumoDados() {
    const d = await this.dados(true);
    const porProduto = new Map<string, { qtd: number; min: number; max: number; entrega: string }>();
    for (const u of d.unidades.filter((x) => /dispon/i.test(x.status))) {
      const p = porProduto.get(u.produto) || { qtd: 0, min: Infinity, max: 0, entrega: u.entrega };
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
      })),
    };
  }

  /* ---------------- ferramentas da IA ---------------- */

  private async buscarUnidades(a: { empreendimento?: string; tipo?: string; preco_max?: number; unidade?: string }) {
    const { unidades } = await this.dados();
    if (!unidades.length) return { erro: "Tabela de unidades ainda não carregada. Mande o link da tabela de preços." };
    let lista = unidades.filter((u) => /dispon/i.test(u.status));
    if (a.unidade) {
      const alvo = a.unidade.replace(/\s/g, "").toLowerCase();
      lista = unidades.filter((u) => u.unidade.replace(/\s/g, "").toLowerCase().includes(alvo));
    }
    if (a.empreendimento) {
      const p = acharPorNome([...new Set(unidades.map((u) => u.produto))], a.empreendimento, (x) => x);
      if (p) lista = lista.filter((u) => u.produto === p);
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
    const s = simularPagamento({ preco, tabela: a.tabela, mesesObra: meses, financiamento: a.financiamento, fgtsSubsidio: a.fgts_subsidio });
    return { texto: textoSimulacao(s, rotulo || "unidade"), simulacao: s };
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
          `- ${e.nome} (módulo ${e.modulo}): a partir de R$ ${e.valorVenda.toLocaleString("pt-BR")} · avaliação R$ ${e.avaliacao.toLocaleString("pt-BR")} · ${e.estoque} em estoque · ${
            e.mesesEntrega ? `entrega em ${e.mesesEntrega} meses` : "pronto/entregue"
          }`
      )
      .join("\n");
    const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "long", year: "numeric" });
    return `Você é a **One**, assistente da equipe comercial do Kayser One (imobiliária/CRM). Fala com CORRETORES e GESTORES pelo WhatsApp — nunca com cliente final.
Hoje é ${hoje}. Responda em português, curto e direto (WhatsApp), com emojis leves. Use *negrito* do WhatsApp quando ajudar.

QUEM ESTÁ FALANDO: ${this.statusConta(user)}

O QUE VOCÊ FAZ:
1) SUPORTE do Kayser One (sistema):
- Instalar: abrir kayserone.com.br no celular → "Adicionar à tela inicial".
- Primeiro acesso: senha padrão 123456789; o sistema pede pra criar a senha nova. Esqueceu a senha → o gestor redefine em Configurações → Equipe (volta pra 123456789).
- Cadastro novo precisa ser APROVADO pelo gestor (sino 🔔). Conta desativada → falar com o gestor.
- Check-in do plantão: automático pelo GPS ao abrir o Kayser no stand; até 1,5 km do stand; abre 1 h antes e fecha na hora do início do turno (09:00 ok, 09:01 fora). Precisa PERMITIR a localização. GPS demorando → ligar Localização e Wi-Fi, ir pra perto da janela. Não deu → o Diretor vê o motivo no painel e pode liberar.
- Bloqueado no plantão → falar com o gestor (bloqueio do Diretor só o Diretor tira).
- Lead novo: aviso com fogos, 15 min pro primeiro contato, "Atender agora" abre a conversa. Kanban: mover as etapas; "Cliente sem interesse" volta pro Diretor. Corujão: até 20 leads/dia.
2) PRODUTOS E PREÇOS: responda com os dados abaixo e as ferramentas (buscar_unidades traz unidade, status, entrega e preço). NUNCA invente preço, unidade ou data.
3) SIMULAÇÃO DE PAGAMENTO: use SEMPRE a ferramenta simular_pagamento (não faça conta de cabeça) e mande o texto que ela devolver.
   - Tabela padrão: 10% ato · 20% durante a obra · 70% pós-obra em 120x.
   - Tabela investidor: 10% ato · 90% durante a obra até a entrega.
   - Financiamento Caixa: pergunte o valor aprovado e FGTS/subsídio se o corretor não informou.
4) MATERIAIS: para mandar FOTOS de um empreendimento escreva [FOTOS: Nome do empreendimento] numa linha. Para mandar as CONDIÇÕES DO MÊS (imagem) escreva [CONDICOES].
5) NÃO MANDE LINK NENHUM (nem de tabela, planilha, painel ou site): responda direto com a informação. Preço que não estiver nos dados abaixo → diga que vai confirmar com o gestor.

${d.simulador.campanha ? `CAMPANHA / BASE: ${d.simulador.campanha}\n` : ""}EMPREENDIMENTOS (planilha atualizada):
${emps || "(planilha ainda não configurada)"}

UNIDADES PROMOCIONAIS (planilha):
${d.promocoes.join("\n") || "(nenhuma)"}

MATERIAIS E INFORMAÇÕES EXTRAS (do Diretor):
${(s.ioneInfo || "").trim() || "(nenhum)"}

REGRAS: se não souber, diga que vai confirmar com o gestor. Se a pessoa NÃO for da equipe, não passe preço nem condição.`;
  }

  /* ---------------- conversa ---------------- */

  /** Gera a resposta da One (com ferramentas). Não envia nada. */
  async responder(user: User | null, phone: string, texto: string) {
    const s: any = await this.settings.get();
    if (!s.ioneClaudeKey) throw new BadRequestException("Chave da Claude da IA One não configurada (aba IA One).");
    const historico = await this.msgs.find({ where: { phone }, order: { createdAt: "DESC" }, take: 12 });
    const messages: any[] = historico
      .reverse()
      .map((m) => ({ role: m.direction === "in" ? "user" : "assistant", content: m.content }));
    if (!messages.length || messages[messages.length - 1].content !== texto || messages[messages.length - 1].role !== "user") {
      messages.push({ role: "user", content: texto });
    }
    // A API exige começar com "user" e alternar.
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
        name: "simular_pagamento",
        description: "Simula o fluxo de pagamento. Use sempre que pedirem simulação/fluxo/parcelas.",
        input_schema: {
          type: "object",
          properties: {
            empreendimento: { type: "string" },
            unidade: { type: "string", description: "Identificador da unidade, se houver" },
            valor: { type: "number", description: "Valor da unidade em reais, se informado" },
            tabela: { type: "string", enum: ["padrao", "investidor", "caixa"] },
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
          r = u.name === "buscar_unidades" ? await this.buscarUnidades(u.input) : await this.simular(u.input);
        } catch (e) {
          r = { erro: (e as Error).message };
        }
        resultados.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(r).slice(0, 12000) });
      }
      messages.push({ role: "user", content: resultados });
    }
    return "Vou confirmar essa informação com o gestor e já te retorno. 🙏";
  }

  /** Separa as marcações [FOTOS: x] e [CONDICOES] do texto. */
  separar(texto: string) {
    const fotos = [...texto.matchAll(TAG_FOTOS)].map((m) => m[1].trim());
    const condicoes = TAG_CONDICOES.test(texto);
    const limpo = texto.replace(TAG_FOTOS, "").replace(TAG_CONDICOES, "").replace(/\n{3,}/g, "\n\n").trim();
    return { limpo, fotos: [...new Set(fotos)].slice(0, 2), condicoes };
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

    if (!user || user.active === false) {
      await this.enviar(
        phone,
        user
          ? "Oi! Sua conta no Kayser One está desativada. Fale com o seu gestor pra reativar. 🙏"
          : "Oi! Eu sou a *One*, assistente da equipe Kayser One. 👋\nEste número é só pra corretores e gestores cadastrados. Peça pro seu gestor conferir o seu telefone no cadastro do Kayser.",
        user,
        p.pushName
      );
      return { ok: true };
    }

    try {
      const bruto = await this.responder(user, phone, texto);
      const { limpo, fotos, condicoes } = this.separar(bruto);
      if (limpo) await this.enviar(phone, limpo, user, p.pushName);
      for (const nome of fotos) {
        const f = await this.knowledge.fotosDoEmpreendimento(nome, 5).catch(() => null);
        for (const foto of f?.fotos ?? []) await this.whatsapp.sendMedia(IA_ONE_INSTANCIA, phone, foto).catch(() => {});
        if (f?.fotos?.length) await this.salvar(phone, user, p.pushName, "out", `📷 ${f.fotos.length} foto(s) do ${f.nome}`);
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
    await this.whatsapp.sendText(IA_ONE_INSTANCIA, phone, texto);
    await this.salvar(phone, user, nome, "out", texto);
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
