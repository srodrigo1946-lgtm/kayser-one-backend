import { indiceDoProximo } from "./lead-queue.service";

describe("Fila: o próximo é a PESSOA, não a posição", () => {
  it("alguém entra no meio da lista: o próximo continua sendo a mesma pessoa", () => {
    // Era: [A, B, C, D, E], próximo = D (posição 3).
    const depois = ["A", "B", "X", "C", "D", "E"]; // X fez check-in e caiu antes do D
    expect(depois[indiceDoProximo(depois, "D", 3)]).toBe("D");
  });
  it("alguém sai: continua sendo a mesma pessoa", () => {
    expect(["A", "C", "D"][indiceDoProximo(["A", "C", "D"], "D", 3)]).toBe("D");
  });
  it("o próximo saiu do plantão: usa a posição antiga", () => {
    expect(indiceDoProximo(["A", "B", "C"], "Z", 4)).toBe(1);
  });
});
