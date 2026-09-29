import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import axios from "axios";
import { erroMeta } from "../meta-forms/meta-forms.service";

const GRAPH = "https://graph.facebook.com/v26.0";

/** Soma o gasto por dia (várias contas) → { "2026-09-01": 120.5, ... }. */
export function somarGastoPorDia(linhas: { date_start?: string; spend?: string | number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of linhas) {
    const d = (l.date_start || "").slice(0, 10);
    const v = Number(l.spend);
    if (!d || Number.isNaN(v)) continue;
    out[d] = Math.round(((out[d] ?? 0) + v) * 100) / 100;
  }
  return out;
}
import { InjectRepository } from "@nestjs/typeorm";
import { Between, Repository } from "typeorm";
import { ConfigService } from "@nestjs/config";
import { AdInvestment } from "./ad-investment.entity";
import { AdInvestmentDay } from "./ad-investment-day.entity";
import { SettingsService } from "../settings/settings.service";

@Injectable()
export class InvestimentoService {
  private readonly logger = new Logger(InvestimentoService.name);

  constructor(
    @InjectRepository(AdInvestment)
    private readonly repo: Repository<AdInvestment>,
    @InjectRepository(AdInvestmentDay)
    private readonly dayRepo: Repository<AdInvestmentDay>,
    private readonly settings: SettingsService,
    private readonly config: ConfigService
  ) {}

  /**
   * Investimento do período. Regra: se o mês tem gasto por DIA cadastrado, o
   * total é a SOMA dos dias; senão, cai no valor mensal (retrocompatível).
   * Sem `mes` = soma do ano (dias onde houver, mensal onde não houver).
   */
  async get(ano: number, mes?: number): Promise<{ valor: number }> {
    if (mes) {
      const dias = await this.dayRepo.find({ where: { ano, mes } });
      if (dias.length) return { valor: dias.reduce((a, r) => a + (Number(r.valor) || 0), 0) };
      const row = await this.repo.findOne({ where: { ano, mes } });
      return { valor: Number(row?.valor) || 0 };
    }
    // Ano todo: dias somam onde existem; nos meses sem dia, usa o valor mensal.
    const dayRows = await this.dayRepo.find({ where: { ano } });
    const mesesComDia = new Set(dayRows.map((r) => r.mes));
    const monthRows = await this.repo.find({ where: { ano, mes: Between(1, 12) } });
    const somaDias = dayRows.reduce((a, r) => a + (Number(r.valor) || 0), 0);
    const somaMeses = monthRows
      .filter((r) => !mesesComDia.has(r.mes))
      .reduce((a, r) => a + (Number(r.valor) || 0), 0);
    return { valor: somaDias + somaMeses };
  }

  /** Define (upsert) o investimento mensal (valor único do mês). */
  async set(ano: number, mes: number, valor: number): Promise<{ ok: boolean }> {
    let row = await this.repo.findOne({ where: { ano, mes } });
    if (!row) row = this.repo.create({ ano, mes, fonte: "manual" });
    row.valor = valor;
    row.fonte = "manual";
    await this.repo.save(row);
    return { ok: true };
  }

  /** Gasto por dia do mês (para o editor e o gráfico). */
  async getDays(ano: number, mes: number): Promise<{ dia: number; valor: number; fonte: string }[]> {
    const rows = await this.dayRepo.find({ where: { ano, mes }, order: { dia: "ASC" } });
    return rows.map((r) => ({ dia: r.dia, valor: Number(r.valor) || 0, fonte: r.fonte }));
  }

  /** Salva (upsert) vários dias de uma vez — o Diretor digita no painel. */
  async setDays(ano: number, mes: number, dias: { dia: number; valor: number }[]): Promise<{ ok: boolean }> {
    for (const d of dias) {
      if (!d || d.dia < 1 || d.dia > 31) continue;
      await this.upsertDay(ano, mes, d.dia, Number(d.valor) || 0, "manual");
    }
    return { ok: true };
  }

  /** Apaga o gasto por dia do mês — volta a usar o valor único mensal. */
  async clearDays(ano: number, mes: number): Promise<{ ok: boolean }> {
    await this.dayRepo.delete({ ano, mes });
    return { ok: true };
  }

  private async upsertDay(ano: number, mes: number, dia: number, valor: number, fonte: string) {
    let row = await this.dayRepo.findOne({ where: { ano, mes, dia } });
    if (!row) row = this.dayRepo.create({ ano, mes, dia });
    row.valor = valor;
    row.fonte = fonte;
    await this.dayRepo.save(row);
  }

  /**
   * Puxa do Meta (Marketing API) o GASTO POR DIA das contas de anúncio do mês e grava
   * como gasto diário (fonte "facebook"). Investimento, Custo por Lead e ROI passam a
   * sair sozinhos. Roda de hora em hora e pelo botão na tela.
   */
  async sincronizarMeta(ano: number, mes: number): Promise<{ dias: number; total: number; erro?: string }> {
    const s: any = await this.settings.get().catch(() => null);
    const token: string = s?.metaPageToken || this.config.get<string>("META_PAGE_ACCESS_TOKEN") || "";
    if (!token) return { dias: 0, total: 0, erro: "Token do Meta não configurado (Configurações → Integrações)." };
    const contas = String(s?.metaAdAccountIds || "")
      .split(",")
      .map((x) => x.trim().replace(/^act_/, ""))
      .filter(Boolean);
    if (!contas.length) return { dias: 0, total: 0, erro: "Nenhuma conta de anúncio configurada." };

    const pad = (n: number) => String(n).padStart(2, "0");
    const ultimo = new Date(ano, mes, 0).getDate();
    const since = `${ano}-${pad(mes)}-01`;
    const until = `${ano}-${pad(mes)}-${pad(ultimo)}`;
    try {
      const linhas: any[] = [];
      for (const conta of contas) {
        let url: string | null = `${GRAPH}/act_${conta}/insights`;
        let params: any = {
          access_token: token,
          fields: "spend",
          level: "account",
          time_increment: 1,
          time_range: JSON.stringify({ since, until }),
          limit: 100,
        };
        for (let p = 0; url && p < 5; p++) {
          const { data }: any = await axios.get(url, { params });
          linhas.push(...(data?.data ?? []));
          url = data?.paging?.next ?? null;
          params = undefined;
        }
      }
      const porDia = somarGastoPorDia(linhas);
      let total = 0;
      for (const [data, valor] of Object.entries(porDia)) {
        const dia = Number(data.slice(8, 10));
        await this.upsertDay(ano, mes, dia, valor, "facebook");
        total += valor;
      }
      total = Math.round(total * 100) / 100;
      this.logger.log(`Gasto do Meta ${pad(mes)}/${ano}: ${Object.keys(porDia).length} dia(s), R$ ${total}.`);
      return { dias: Object.keys(porDia).length, total };
    } catch (err: any) {
      const msg = erroMeta(err);
      this.logger.warn(`Gasto do Meta falhou: ${msg}`);
      return { dias: 0, total: 0, erro: msg };
    }
  }

  /** Automático: de hora em hora puxa o gasto do mês atual (no dia 1, fecha o mês anterior também). */
  @Cron("7 * * * *", { timeZone: "America/Sao_Paulo" })
  async sincronizarMetaAutomatico() {
    const agora = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    await this.sincronizarMeta(agora.getFullYear(), agora.getMonth() + 1);
    if (agora.getDate() === 1) {
      const ant = new Date(agora.getFullYear(), agora.getMonth() - 1, 1);
      await this.sincronizarMeta(ant.getFullYear(), ant.getMonth() + 1);
    }
  }

  /** Verify Token (Configurações → Integrações, senão env) — mesma chave do Meta. */
  private async verifyToken(): Promise<string> {
    const s = await this.settings.get().catch(() => null);
    return (s as any)?.metaVerifyToken || this.config.get<string>("META_VERIFY_TOKEN") || "";
  }

  /**
   * Entrada DIRETA do gasto de um dia (FiqOn/Make empurra o gasto do Facebook).
   * Protegido pelo mesmo Verify Token. Aceita {ano,mes,dia} ou {date:"YYYY-MM-DD"}.
   */
  async setDayDireto(token: string, body: any): Promise<{ ok: boolean }> {
    if (!token || token !== (await this.verifyToken())) return { ok: false };
    let ano = Number(body?.ano);
    let mes = Number(body?.mes);
    let dia = Number(body?.dia);
    const date: string | undefined = body?.date || body?.data;
    if (date && /^\d{4}-\d{2}-\d{2}/.test(date)) {
      const [y, m, d] = date.slice(0, 10).split("-").map(Number);
      ano = y; mes = m; dia = d;
    }
    const valor = Number(body?.valor ?? body?.spend ?? body?.gasto);
    if (!ano || !mes || !dia || Number.isNaN(valor)) return { ok: false };
    if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return { ok: false };
    await this.upsertDay(ano, mes, dia, valor, "facebook");
    return { ok: true };
  }
}
