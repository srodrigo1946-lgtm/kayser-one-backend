import { PastasService } from "./pastas.service";
import { ForbiddenException } from "@nestjs/common";

describe("PastasService", () => {
  let repo: any;
  let leadsRepo: any;
  let users: any;
  let documents: any;
  let service: PastasService;

  beforeEach(() => {
    repo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: "p1", ...x })),
      query: jest.fn().mockResolvedValue([{ n: 1 }]),
    };
    leadsRepo = { findOne: jest.fn() };
    users = { getScopeIds: jest.fn().mockResolvedValue(null) }; // Diretor por padrão
    documents = {
      createRequest: jest.fn().mockResolvedValue({ id: "r1", token: "tok1" }),
      listFilesByRequestId: jest.fn().mockResolvedValue({
        request: { id: "r1", clientName: "Zé" },
        documents: [{ id: "d1", tipo: "rg_cnh", filename: "rg.png", uploadedAt: new Date() }],
      }),
      getFileRaw: jest.fn().mockResolvedValue({
        buffer: Buffer.from(""),
        contentType: "image/png",
        filename: "rg.png",
        requestId: "r1",
      }),
    };
    service = new PastasService(repo, leadsRepo, users, documents);
  });

  const empresa = { id: "u-emp", empresaId: "emp1" } as any;
  const corretor = { id: "c1", empresaId: null, role: "corretor" } as any;
  const gerente = { id: "g1", empresaId: null, role: "gerente" } as any;
  const gerenteGeral = { id: "gg1", empresaId: null, role: "gerente_geral" } as any;
  const diretor = { id: "d1", empresaId: null, role: "diretor" } as any;
  const minsAgo = (m: number) => new Date(Date.now() - m * 60 * 1000);

  it("numera a análise com max(numero)+1 e gera o ambiente de documentos", async () => {
    leadsRepo.findOne.mockResolvedValue({ id: "l1", name: "Zé", phone: "9" });
    repo.query.mockResolvedValue([{ n: 5 }]);
    await service.create({ leadId: "l1" } as any, corretor);
    expect(repo.create.mock.calls[0][0].numero).toBe(5);
    expect(documents.createRequest).toHaveBeenCalled();
  });

  it("empresa só lista as pastas atribuídas a ela (por empresaId)", async () => {
    await service.list(empresa);
    expect(repo.find.mock.calls[0][0].where.empresaId).toBe("emp1");
  });

  it("empresa sem liberação não recebe os arquivos (aguardando)", async () => {
    repo.findOne.mockResolvedValue({
      id: "p1", empresaId: "emp1", documentRequestId: "r1", docsReleasedAt: null, clientName: "Zé",
    });
    const res: any = await service.listFiles("p1", empresa);
    expect(res.documents).toEqual([]);
    expect(res.window.released).toBe(false);
    expect(res.window.active).toBe(false);
  });

  it("empresa com janela ativa recebe os arquivos e o tempo restante", async () => {
    repo.findOne.mockResolvedValue({
      id: "p1", empresaId: "emp1", documentRequestId: "r1", docsReleasedAt: new Date(), clientName: "Zé",
    });
    const res: any = await service.listFiles("p1", empresa);
    expect(res.documents.length).toBe(1);
    expect(res.window.active).toBe(true);
    expect(res.window.remainingMs).toBeGreaterThan(0);
  });

  it("empresa com janela expirada (41 min) não recebe arquivos (arquivado)", async () => {
    repo.findOne.mockResolvedValue({
      id: "p1", empresaId: "emp1", documentRequestId: "r1", docsReleasedAt: minsAgo(41), clientName: "Zé",
    });
    const res: any = await service.listFiles("p1", empresa);
    expect(res.documents).toEqual([]);
    expect(res.window.archived).toBe(true);
  });

  it("getFile bloqueia a empresa fora da janela (403)", async () => {
    repo.findOne.mockResolvedValue({
      id: "p1", empresaId: "emp1", documentRequestId: "r1", docsReleasedAt: minsAgo(41),
    });
    await expect(service.getFile("p1", "d1", empresa)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("getFile: corretor/Diretor acessam mesmo com janela expirada (buscar do arquivo)", async () => {
    repo.findOne.mockResolvedValue({
      id: "p1", empresaId: "emp1", documentRequestId: "r1", docsReleasedAt: minsAgo(41), responsavelId: "c1",
    });
    const f = await service.getFile("p1", "d1", corretor);
    expect(f.filename).toBe("rg.png");
  });

  it("releaseDocs: empresa não pode liberar a própria janela", async () => {
    await expect(service.releaseDocs("p1", empresa)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("releaseDocs: corretor libera e grava docsReleasedAt (janela ativa)", async () => {
    repo.findOne.mockResolvedValue({ id: "p1", responsavelId: "c1", docsReleasedAt: null });
    const win = await service.releaseDocs("p1", corretor);
    expect(repo.save).toHaveBeenCalled();
    expect(win.released).toBe(true);
    expect(win.active).toBe(true);
  });

  it("updateStatus: corretor NÃO pode dar veredito (aprovado → 403)", async () => {
    repo.findOne.mockResolvedValue({ id: "p1", responsavelId: "c1" });
    await expect(service.updateStatus("p1", "aprovado", corretor)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("updateStatus: corretor pode mover para em_analise", async () => {
    repo.findOne.mockResolvedValue({ id: "p1", responsavelId: "c1" });
    const res: any = await service.updateStatus("p1", "em_analise", corretor);
    expect(res.status).toBe("em_analise");
  });

  it("updateStatus: Diretor pode aprovar", async () => {
    repo.findOne.mockResolvedValue({ id: "p1", responsavelId: "c1" });
    const res: any = await service.updateStatus("p1", "aprovado", diretor);
    expect(res.status).toBe("aprovado");
  });

  it("updateStatus: empresa parceira pode reprovar", async () => {
    repo.findOne.mockResolvedValue({ id: "p1", empresaId: "emp1" });
    const res: any = await service.updateStatus("p1", "reprovado", empresa);
    expect(res.status).toBe("reprovado");
  });

  it("ranking: corretor NÃO pode ver (403)", async () => {
    await expect(service.analysesRanking(corretor)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("ranking: gerente de vendas NÃO pode ver (403)", async () => {
    await expect(service.analysesRanking(gerente)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("export Excel: só Diretor (Gerente Geral → 403)", async () => {
    await expect(service.exportAnalyses(gerenteGeral)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
