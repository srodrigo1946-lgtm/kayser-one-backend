import { createHash } from "crypto";
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

/**
 * "Versão" da senha que vai dentro do token (`pv`): um resumo do hash atual.
 * Trocou a senha (por qualquer caminho: tela, gestor, IA One, recuperação) → o hash
 * muda → tokens antigos param de valer. Resumo do hash (e não o hash) porque o
 * conteúdo do JWT é legível por quem tem o token.
 */
export function versaoSenha(passwordHash: string): string {
  return createHash("sha256").update(passwordHash || "").digest("base64url").slice(0, 16);
}
