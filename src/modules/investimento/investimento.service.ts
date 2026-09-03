import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Between, Repository } from "typeorm";
import { AdInvestment } from "./ad-investment.entity";

@Injectable()
export class InvestimentoService {
  constructor(
    @InjectRepository(AdInvestment)
    private readonly repo: Repository<AdInvestment>
  ) {}

  /** Investimento do período: um mês, ou a soma do ano quando `mes` é omitido. */
  async get(ano: number, mes?: number): Promise<{ valor: number }> {
    if (mes) {
      const row = await this.repo.findOne({ where: { ano, mes } });
      return { valor: Number(row?.valor) || 0 };
    }
    const rows = await this.repo.find({ where: { ano, mes: Between(1, 12) } });
    return { valor: rows.reduce((acc, r) => acc + (Number(r.valor) || 0), 0) };
  }

  /** Define (upsert) o investimento de um mês. */
  async set(ano: number, mes: number, valor: number): Promise<{ ok: boolean }> {
    let row = await this.repo.findOne({ where: { ano, mes } });
    if (!row) row = this.repo.create({ ano, mes, fonte: "manual" });
    row.valor = valor;
    row.fonte = "manual";
    await this.repo.save(row);
    return { ok: true };
  }
}
