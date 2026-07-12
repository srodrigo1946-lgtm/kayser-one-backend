import { ConfigService } from "@nestjs/config";

/**
 * Resolve o segredo do JWT. Em PRODUÇÃO, falha (fail-fast) se `JWT_SECRET` não
 * estiver configurado — evita rodar com um segredo padrão conhecido, o que
 * permitiria a qualquer um forjar tokens (inclusive de Diretor).
 * Em desenvolvimento, usa um padrão local por conveniência.
 */
export function resolveJwtSecret(config: ConfigService): string {
  const secret = config.get<string>("JWT_SECRET");
  if (secret) return secret;
  if (config.get("NODE_ENV") === "production") {
    throw new Error(
      "JWT_SECRET não configurado em produção. Defina uma chave forte e aleatória na variável de ambiente."
    );
  }
  return "kayser-one-dev-secret";
}
