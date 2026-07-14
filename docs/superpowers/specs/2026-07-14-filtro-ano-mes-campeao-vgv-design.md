# Filtro ano/mês na Evolução Mensal + Campeão por VGV

**Data:** 2026-07-14 · **Status:** Aprovado

## Objetivo
No card "Evolução Mensal" do Dashboard: filtrar o gráfico por **ano** (Jan–Dez) e
mostrar o **campeão** (corretor com maior **VGV** = soma do valor das vendas) do
período — ano todo ou um mês específico.

## Decisões (aprovadas)
- Campeão = maior **VGV** (não nº de leads). Empate desempata por nº de vendas.
- O valor de cada venda vem de um **campo novo `valorVenda`** no lead (o corretor
  preenche ao fechar). Vendas antigas ficam 0 até serem preenchidas.

## Backend
- **`Lead.valorVenda`** (decimal, nullable) + `SchemaBootstrap` (ADD COLUMN IF NOT
  EXISTS). DTOs de create/update aceitam `valorVenda?`.
- **`DashboardService.getMonthlyData(user, year?)`**: 12 meses do ano informado
  (default = ano atual). Mantém leads/visitas/vendas por mês.
- **`DashboardService.getChampion(user, year, month?)`**: top corretor por
  `SUM(valorVenda)` onde `status = Venda Ganha` e `updatedAt` no período (mês, se
  informado; senão o ano todo). Retorna `{ responsavelId, nome, hasAvatar, vgv,
  vendas }` ou `null` se não houver vendas. Escopado por `getScopeIds`.
- **Controller**: `GET /dashboard/chart/monthly?year=` e
  `GET /dashboard/champion?year=&month=`.

## Frontend
- **`SalesChart`** vira autônomo: estado interno `year` (default atual) e `month`
  (default "Ano todo"). Dois selects. Busca `useMonthlyData(year)` e
  `useChampion(year, month)`. Renderiza o gráfico + um **card do campeão** (foto,
  nome, VGV em R$, nº de vendas; ou "Sem vendas registradas").
- **`use-dashboard`**: `useMonthlyData(year)` (query key inclui year) + novo
  `useChampion(year, month)`.
- **`lead-detail-drawer`**: campo "Valor da venda" (R$), salvo via update do lead.
- Dashboard e Relatórios passam a usar `<SalesChart />` sem prop `data`.

## Escopo/permissão
Tudo respeita a hierarquia (Diretor tudo; gestor equipe; corretor os seus).

## Fora do escopo (v1)
Arrastar pro "Venda Ganha" no Kanban não abre popup pedindo o valor (fica no drawer).

## Verificação
Build (Railway/Vercel) + teste real do Rodrigo. Testes unitários adiados (disco cheio).
