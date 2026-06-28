import { EmbeddingService } from "./embedding.service";

describe("EmbeddingService.cosine", () => {
  it("vetores idênticos têm similaridade 1", () => {
    expect(EmbeddingService.cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 5);
  });

  it("vetores ortogonais têm similaridade 0", () => {
    expect(EmbeddingService.cosine([1, 0], [0, 1])).toBe(0);
  });

  it("vetor nulo retorna 0 (sem divisão por zero)", () => {
    expect(EmbeddingService.cosine([0, 0], [1, 1])).toBe(0);
  });

  it("ordena por proximidade corretamente", () => {
    const q = [1, 0];
    const a = EmbeddingService.cosine(q, [0.9, 0.1]);
    const b = EmbeddingService.cosine(q, [0.1, 0.9]);
    expect(a).toBeGreaterThan(b);
  });
});
