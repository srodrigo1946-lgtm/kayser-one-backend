# Código de recuperação do Diretor (design)

**Data:** 2026-07-13 · **Status:** aprovado

## Objetivo
Dar ao Diretor (topo da hierarquia, sem ninguém para resetá-lo e sem e-mail) uma forma
self-service de recuperar a senha: um "código de recuperação" secreto, definido em advance.

## Backend
- Campo `users.recoveryCodeHash` (text, nullable), bcrypt, NUNCA exposto (sanitizadores).
- SchemaBootstrap: `ALTER TABLE users ADD COLUMN IF NOT EXISTS "recoveryCodeHash" text`.
- `AuthService.setRecoveryCode(userId, code)`: bcrypt(code, 12) → salva.
- `AuthService.recover({ email, recoveryCode, newPassword })`: acha user por email COM role DIRETOR
  e recoveryCodeHash setado; `bcrypt.compare`; se ok → nova senha (firstLogin=false). Erros genéricos.
- Endpoints:
  - `PUT /auth/recovery-code` (JwtAuthGuard + só Diretor) `{ recoveryCode }` (min 6).
  - `POST /auth/recover` (público, @Throttle 5/min) `{ email, recoveryCode, newPassword(min 6) }`.
  - `GET /auth/me` passa a incluir `hasRecoveryCode: boolean`.
- Sanitizar `recoveryCodeHash` em auth.sanitize e users.clean.

## Frontend
- **Configurações (só Diretor)**: card "Código de recuperação" — cadastra/troca, mostra "configurado".
- **Login → "Esqueceu a senha?"**: bloco "É o Diretor? Recupere com seu código" → form
  (email + código + nova senha) → chama /recover → sucesso → loga com a nova senha.

## Segurança
Código com hash (2ª senha), rate-limit forte, só Diretor, erros genéricos. Só protege após o
Diretor cadastrar o código (avisar para cadastrar logo).

## Fora de escopo (YAGNI)
Recuperação por e-mail/WhatsApp, múltiplos códigos, expiração de código.
