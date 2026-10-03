import { ForbiddenException } from "@nestjs/common";
import { LeadsService } from "./leads.service";
import { UserRole } from "../users/user.entity";

function servico(query: (q: string, p?: any[]) => any) {
  const leadsRepo: any = { manager: { query: async (q: string, p?: any[]) => query(q, p) } };
  return new LeadsService(leadsRepo, {} as any, {} as any, {} as any, {} as any, { get: () => undefined } as any);
}

describe("Permissões de leads (segurança 02/10)", () => {
  it("coluna 'só gerentes' barra corretor em qualquer rota, libera gestor", async () => {
    const s: any = servico(async () => [{ somenteGestores: true }]);
    await expect(s.checarColunaGestores("arquivo_times", { role: UserRole.CORRETOR })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(s.checarColunaGestores("arquivo_times", { role: UserRole.GERENTE })).resolves.toBeUndefined();
  });

  it("apagar planilha: corretor só apaga os leads que ainda estão com ele", async () => {
    const qs: { q: string; p?: any[] }[] = [];
    const s = servico(async (q, p) => {
      qs.push({ q, p });
      if (q.includes("FROM lead_imports")) return [{ id: "imp", userId: "c1" }];
      if (q.startsWith("SELECT id FROM leads")) return [{ id: "l1" }];
      if (q.includes("COUNT(*)")) return [{ n: 2 }];
      return [];
    });
    const r = await s.apagarImportacao("imp", { id: "c1", name: "C", role: UserRole.CORRETOR } as any);
    const sel = qs.find((x) => x.q.startsWith("SELECT id FROM leads"))!;
    expect(sel.q).toContain(`"responsavelId" = $2`);
    expect(sel.p).toEqual(["imp", "c1"]);
    expect(r).toEqual({ removidos: 1, mantidos: 2 });
    expect(qs.some((x) => x.q.includes("apagado = true"))).toBe(false); // ainda tem lead da planilha
  });
});
