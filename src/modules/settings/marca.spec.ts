import { BadRequestException } from "@nestjs/common";
import { SettingsService } from "./settings.service";

describe("Marca própria (white-label)", () => {
  const montar = (s: any) => {
    const salvos: any[] = [];
    const repo = { findOne: async () => s, find: async () => [s], save: async (x: any) => (salvos.push({ ...x }), x), create: (x: any) => x };
    const storage = { upload: async () => null, getObject: async () => null };
    return { svc: new SettingsService(repo as any, storage as any) as any, salvos };
  };

  it("sem marca configurada é Kayser One (padrão)", async () => {
    const { svc } = montar({ id: 1 });
    expect(await svc.marca()).toEqual(expect.objectContaining({ nome: "Kayser One", cor: null, temLogo: false }));
  });

  it("devolve nome e cor da imobiliária; não expõe o logo no getPublic", async () => {
    const { svc } = montar({ id: 1, marcaNome: "Imob X", marcaCor: "#1d4ed8", marcaLogo: "data:image/png;base64,AAAA" });
    expect(await svc.marca()).toEqual(expect.objectContaining({ nome: "Imob X", cor: "#1d4ed8", temLogo: true }));
    const pub = await svc.getPublic();
    expect(pub.marcaLogo).toBeUndefined();
    expect(pub.hasMarcaLogo).toBe(true);
  });

  it("logo só PNG/JPG/WEBP (SVG recusado)", async () => {
    const { svc, salvos } = montar({ id: 1 });
    const svg = { mimetype: "image/svg+xml", buffer: Buffer.from("<svg/>") };
    await expect(svc.setMarcaLogo(svg)).rejects.toBeInstanceOf(BadRequestException);
    await svc.setMarcaLogo({ mimetype: "image/png", buffer: Buffer.from("png") });
    expect(salvos[0].marcaLogo).toMatch(/^data:image\/png;base64,/);
  });
});
