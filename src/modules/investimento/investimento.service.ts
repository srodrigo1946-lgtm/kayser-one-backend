import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Between, Repository } from "typeorm";
import { ConfigService } from "@nestjs/config";
import { AdInvestment } from "./ad-investment.entity";
import { AdInvestmentDay } from "./ad-investment-day.entity";
import { SettingsService } from "../settings/settings.service";

@Injectable()
export class InvestimentoService {
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
