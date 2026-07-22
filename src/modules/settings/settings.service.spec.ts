import { SettingsService } from "./settings.service";
import { AiProvider } from "./settings.entity";

describe("SettingsService", () => {
  let repo: any;
  let service: SettingsService;

  beforeEach(() => {
    repo = {
      findOne: jest.fn(),
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: "s1", ...x })),
    };
    const storage = { upload: jest.fn(), getObject: jest.fn() };
    service = new SettingsService(repo, storage as any);
  });

  it("cria a linha de configuração padrão quando não existe", async () => {
    repo.findOne.mockResolvedValue(null);
    const s = await service.get();
    expect(s.aiProvider).toBe(AiProvider.ANTHROPIC);
    expect(repo.save).toHaveBeenCalled();
  });

  it("getPublic não expõe a chave de API e indica hasApiKey", async () => {
    repo.findOne.mockResolvedValue({ id: "s1", aiProvider: AiProvider.OPENAI, aiApiKey: "sk-secreta" });
    const pub: any = await service.getPublic();
    expect(pub.aiApiKey).toBeUndefined();
    expect(pub.hasApiKey).toBe(true);
  });

  it("não sobrescreve a chave existente quando recebe string vazia", async () => {
    repo.findOne.mockResolvedValue({ id: "s1", aiProvider: AiProvider.ANTHROPIC, aiApiKey: "mantida" });
    await service.update({ aiApiKey: "", followupDays: 5 } as any);
    const saved = repo.save.mock.calls[0][0];
    expect(saved.aiApiKey).toBe("mantida");
    expect(saved.followupDays).toBe(5);
  });
});
