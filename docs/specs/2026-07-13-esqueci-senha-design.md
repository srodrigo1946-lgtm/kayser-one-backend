# "Esqueci a senha" — reset pelo gestor/Diretor (design)

**Data:** 2026-07-13 · **Status:** aprovado

## Objetivo
Permitir recuperar acesso sem e-mail/SMS: o gestor (ou Diretor) redefine a senha de
alguém da sua equipe de volta para a padrão, forçando a criação de nova senha no próximo login.

## Backend
- `UsersService.resetPassword(id, requester)`:
  - carrega o usuário; `assertCanManage(user, requester)` (Diretor: todos; gestor: só a equipe).
  - `passwordHash = bcrypt("123456789", 12)`; `firstLogin = true`.
  - retorna `{ message }`.
- `POST /users/:id/reset-password` — `@Roles(DIRETOR, SUPERINTENDENTE, GERENTE_GERAL, GERENTE)`, `@Request() req`.

## Frontend
- **Configurações → Usuários**: botão **"Redefinir senha"** por usuário (ao lado de Ativar/Desativar),
  com `window.confirm`, chamando `useResetPassword`; mostra feedback com a senha padrão.
- **Login → "Esqueceu a senha?"**: hoje inerte; passa a exibir um aviso
  ("Peça ao seu gestor/Diretor para redefinir. Entra com 123456789 e cria uma nova.").

## Segurança
Escopo por equipe (assertCanManage) + rate-limit global já existente. Senha padrão protegida
pela troca forçada no 1º acesso (firstLogin).

## Fora de escopo (YAGNI)
E-mail, código por WhatsApp, senha temporária aleatória, autoatendimento sem gestor.
