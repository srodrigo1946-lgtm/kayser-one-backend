import AdmZip from "adm-zip";
import { checarZipBomba } from "./zip-guard";

describe("checarZipBomba", () => {
  it("deixa passar arquivo que não é zip", () => {
    expect(() => checarZipBomba(Buffer.from("nome;telefone\nAna;119999"))).not.toThrow();
  });

  it("deixa passar zip normal", () => {
    const z = new AdmZip();
    z.addFile("a.xml", Buffer.alloc(1024 * 1024, "a"));
    expect(() => checarZipBomba(z.toBuffer())).not.toThrow();
  });

  it("barra zip que descompacta além do limite", () => {
    const z = new AdmZip();
    z.addFile("a.xml", Buffer.alloc(3 * 1024 * 1024, "a"));
    expect(() => checarZipBomba(z.toBuffer(), 2)).toThrow(/grande demais/);
  });
});
