import { getMetadataArgsStorage } from "typeorm";
import { User } from "./user.entity";

/**
 * Guarda de regressão: campos de credencial NÃO podem voltar a ser selecionados por
 * padrão. Sem select:false eles vazam em toda resposta que carrega User por relação
 * (kanban, metas, agenda, dashboard) — OWASP API3:2023.
 */
describe("User entity — campos sensíveis", () => {
  const columns = getMetadataArgsStorage().columns.filter((c) => c.target === User);

  it.each(["passwordHash", "recoveryCodeHash", "aiApiKey"])(
    "%s é select:false (não sai em find comum)",
    (name) => {
      const col = columns.find((c) => c.propertyName === name);
      expect(col).toBeDefined();
      expect(col.options.select).toBe(false);
    }
  );
});
