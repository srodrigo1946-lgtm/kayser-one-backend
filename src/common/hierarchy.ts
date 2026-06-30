/**
 * Utilitários de hierarquia de usuários.
 *
 * A visibilidade no Kayser One segue a árvore de gestão (managerId):
 * cada gestor enxerga TODOS os seus descendentes (gerentes → gerentes → corretores).
 */

export interface HierUser {
  id: string;
  managerId?: string | null;
}

/**
 * Retorna o id do usuário + os ids de todos os seus descendentes (recursivo),
 * a partir da lista completa de usuários (apenas id e managerId são necessários).
 */
export function descendantIds(users: HierUser[], rootId: string): string[] {
  const childrenByManager = new Map<string, string[]>();
  for (const u of users) {
    if (!u.managerId) continue;
    const arr = childrenByManager.get(u.managerId) ?? [];
    arr.push(u.id);
    childrenByManager.set(u.managerId, arr);
  }

  const result: string[] = [rootId];
  const stack: string[] = [rootId];
  while (stack.length) {
    const current = stack.pop() as string;
    for (const child of childrenByManager.get(current) ?? []) {
      result.push(child);
      stack.push(child);
    }
  }
  return result;
}
