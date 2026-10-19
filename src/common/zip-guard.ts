import { BadRequestException } from "@nestjs/common";
import AdmZip from "adm-zip";
import { inflateRawSync } from "zlib";

/**
 * Barra "zip bomba" (xlsx/docx/pptx pequeno que descompacta em GB e derruba o servidor).
 * Descompacta cada parte com teto real de saída — não confia no tamanho declarado no zip.
 * Arquivo que não é zip (xls antigo, csv) passa direto. Auditoria 19/10.
 */
export function checarZipBomba(buffer: Buffer, limiteMB = 100) {
  if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) return; // não é zip
  let restante = limiteMB * 1024 * 1024;
  const erro = new BadRequestException(`Arquivo grande demais depois de descompactado (máx. ${limiteMB} MB).`);
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new BadRequestException("Arquivo corrompido.");
  }
  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue;
    const comp = e.getCompressedData();
    let tamanho = comp.length; // método 0 (sem compressão)
    if (e.header.method === 8) {
      try {
        tamanho = inflateRawSync(comp, { maxOutputLength: restante + 1 }).length;
      } catch {
        throw erro;
      }
    }
    restante -= tamanho;
    if (restante < 0) throw erro;
  }
}
