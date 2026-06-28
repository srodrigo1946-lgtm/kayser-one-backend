import { KnowledgeService } from "./knowledge.service";

describe("KnowledgeService (RAG)", () => {
  let repo: any;
  let chunkRepo: any;
  let embeddings: any;
  let storage: any;
  let service: KnowledgeService;

  beforeEach(() => {
    repo = { find: jest.fn(), findOne: jest.fn(), create: jest.fn((x) => x), save: jest.fn(async (x) => ({ id: "k1", ...x })) };
    chunkRepo = { find: jest.fn(), delete: jest.fn(), create: jest.fn((x) => x), save: jest.fn(async (x) => x) };
    embeddings = { embed: jest.fn() };
    storage = { isEnabled: false };
    service = new KnowledgeService(repo, chunkRepo, embeddings, storage);
  });

  it("quebra o texto em chunks de tamanho limitado", () => {
    const chunks = (service as any).chunkText("a".repeat(2500));
    expect(chunks.length).toBe(3);
    expect(chunks[0].length).toBe(1000);
  });

  it("recupera por similaridade do cosseno quando há embeddings", async () => {
    embeddings.embed.mockResolvedValue([1, 0]);
    chunkRepo.find.mockResolvedValue([
      { content: "RELEVANTE", embedding: [1, 0] },
      { content: "irrelevante", embedding: [0, 1] },
    ]);
    const ctx = await service.retrieve("pergunta");
    expect(ctx.startsWith("RELEVANTE")).toBe(true);
  });

  it("cai para busca por palavra-chave quando não há embeddings", async () => {
    embeddings.embed.mockResolvedValue(null);
    chunkRepo.find.mockResolvedValue([
      { content: "regras de financiamento e FGTS", embedding: null },
      { content: "horário de funcionamento", embedding: null },
    ]);
    const ctx = await service.retrieve("financiamento");
    expect(ctx).toContain("financiamento");
  });

  it("usa o contexto completo quando não há chunks indexados", async () => {
    chunkRepo.find.mockResolvedValue([]);
    repo.find.mockResolvedValue([{ title: "FAQ", type: "faq", content: "conteúdo" }]);
    const ctx = await service.retrieve("qualquer");
    expect(ctx).toContain("FAQ");
  });
});
