import { ehGestor } from "./kanban.service";

describe("Coluna só pra gerente pra cima", () => {
  it("gerente, gerente geral, superintendente e diretor veem; corretor não", () => {
    for (const r of ["diretor", "superintendente", "gerente_geral", "gerente"]) expect(ehGestor({ role: r })).toBe(true);
    expect(ehGestor({ role: "corretor" })).toBe(false);
    expect(ehGestor(null)).toBe(false);
  });
});
