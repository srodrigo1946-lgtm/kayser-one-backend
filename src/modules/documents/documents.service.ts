import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { randomInt } from "crypto";
import { DocumentRequest } from "./document-request.entity";
import { Document } from "./document.entity";
import { StorageService } from "../storage/storage.service";

export interface ChecklistItem {
  key: string;
  label: string;
}

/** Monta o checklist conforme fase (simplificada/completa), perfil (clt/autônomo) e estado civil. */
function buildChecklist(req: DocumentRequest): ChecklistItem[] {
  const completa = req.fase === "completa";
  const items: ChecklistItem[] = [
    { key: "rg_cnh", label: "RG ou CNH" },
    { key: "comprovante_residencia", label: "Comprovante de residência" },
  ];
  if (req.perfil === "autonomo") {
    items.push({ key: "extrato", label: completa ? "12 extratos bancários" : "6 extratos bancários" });
  } else {
    items.push({ key: "contracheque", label: completa ? "3 últimos contracheques" : "1 contracheque" });
  }
  if (completa && req.declaraIR) {
    items.push({ key: "ir", label: "Declaração completa de Imposto de Renda" });
  }
  if (req.estadoCivil === "casado") {
    items.push({ key: "certidao_casamento", label: "Certidão de casamento" });
  } else {
    items.push({ key: "certidao_nascimento", label: "Certidão de nascimento" });
  }
  return items;
}

function shortToken(len = 8) {
  // Alfabeto sem caracteres ambíguos (0/O/1/l/i).
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let t = "";
  for (let i = 0; i < len; i++) t += alphabet[randomInt(alphabet.length)];
  return t;
}

function slug(s: string) {
  return (
    (s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "documento"
  );
}

/** Nome de pasta amigável no R2: NomeDoCliente_Telefone (fácil de achar). */
function folderName(req: DocumentRequest): string {
  const name = slug(req.clientName);
  const phone = (req.clientPhone || "").replace(/\D/g, "");
  return [name, phone].filter(Boolean).join("_") || req.token || req.id;
}

/** Rótulo legível do tipo de documento, usado no nome do arquivo (fácil de identificar). */
const TIPO_LABELS: Record<string, string> = {
  rg_cnh: "RG-ou-CNH",
  comprovante_residencia: "Comprovante-de-residencia",
  contracheque: "Contracheque",
  extrato: "Extrato-bancario",
  ir: "Imposto-de-renda",
  certidao_nascimento: "Certidao-de-nascimento",
  certidao_casamento: "Certidao-de-casamento",
};

function tipoLabel(tipo: string): string {
  return TIPO_LABELS[tipo] || slug(tipo);
}

@Injectable()
export class DocumentsService {
  constructor(
    @InjectRepository(DocumentRequest)
    private readonly reqRepo: Repository<DocumentRequest>,
    @InjectRepository(Document)
    private readonly docRepo: Repository<Document>,
    private readonly storage: StorageService
  ) {}

  async createRequest(data: Partial<DocumentRequest>, userId?: string) {
    // Token curto e amigável (sem caracteres ambíguos), único.
    let token = shortToken();
    for (let i = 0; i < 5; i++) {
      const exists = await this.reqRepo.findOne({ where: { token } });
      if (!exists) break;
      token = shortToken();
    }
    const req = this.reqRepo.create({ ...data, token, createdById: userId });
    return this.reqRepo.save(req);
  }

  /** Visão pública (cliente) do link: checklist + o que já chegou. */
  async getByToken(token: string) {
    const req = await this.reqRepo.findOne({ where: { token }, relations: ["documents"] });
    if (!req) throw new NotFoundException("Link inválido ou expirado.");
    const checklist = buildChecklist(req).map((it) => {
      const files = (req.documents || []).filter((d) => d.tipo === it.key);
      return { ...it, recebido: files.length > 0, count: files.length };
    });
    return {
      clientName: req.clientName,
      fase: req.fase,
      checklist,
      concluido: checklist.every((c) => c.recebido),
    };
  }

  async upload(token: string, tipo: string, file: Express.Multer.File) {
    if (!file) throw new NotFoundException("Arquivo não enviado.");
    const req = await this.reqRepo.findOne({ where: { token } });
    if (!req) throw new NotFoundException("Link inválido.");

    const ext = (file.originalname.split(".").pop() || "bin").toLowerCase();
    const date = new Date().toISOString().slice(0, 10);
    const filename = `${slug(req.clientName)}_${(req.clientPhone || "").replace(/\D/g, "")}_${date}_${tipoLabel(tipo)}.${ext}`;

    let fileKey: string;
    if (this.storage.isEnabled) {
      const key = `docs/${folderName(req)}/${Date.now()}-${filename}`;
      const stored = await this.storage.upload(key, file.buffer, file.mimetype);
      fileKey = stored || `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
    } else {
      fileKey = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
    }

    const doc = this.docRepo.create({ requestId: req.id, tipo, filename, fileKey, contentType: file.mimetype });
    await this.docRepo.save(doc);
    return { ok: true, filename };
  }

  /** Lista os arquivos de uma solicitação (para o gestor baixar). */
  async listFiles(requestId: string) {
    const req = await this.reqRepo.findOne({ where: { id: requestId }, relations: ["documents"] });
    if (!req) throw new NotFoundException("Solicitação não encontrada.");
    return {
      request: {
        id: req.id,
        clientName: req.clientName,
        clientPhone: req.clientPhone,
        fase: req.fase,
        token: req.token,
      },
      documents: (req.documents || []).map((d) => ({
        id: d.id,
        tipo: d.tipo,
        filename: d.filename,
        uploadedAt: d.uploadedAt,
      })),
    };
  }

  async getFile(docId: string) {
    const doc = await this.docRepo.findOne({ where: { id: docId } });
    if (!doc) throw new NotFoundException("Documento não encontrado.");
    if (doc.fileKey.startsWith("data:")) {
      const m = doc.fileKey.match(/^data:(.+?);base64,(.*)$/s);
      return {
        buffer: Buffer.from(m ? m[2] : "", "base64"),
        contentType: doc.contentType || (m ? m[1] : "application/octet-stream"),
        filename: doc.filename,
      };
    }
    const obj = await this.storage.getObject(doc.fileKey);
    if (!obj) throw new NotFoundException("Arquivo indisponível.");
    return { buffer: obj.buffer, contentType: obj.contentType, filename: doc.filename };
  }

  /**
   * Organiza os documentos no R2 em pastas amigáveis (NomeCliente_Telefone):
   * - os que ainda estão como data URI no banco → sobem pro R2;
   * - os que já estão no R2 mas em pasta antiga (ID) → são copiados pra pasta
   *   amigável e a cópia antiga é apagada.
   * Idempotente: quem já está na pasta certa é ignorado; nada é perdido.
   */
  async organizeR2() {
    if (!this.storage.isEnabled) {
      return { ok: false, reason: "R2 não está configurado.", migrated: 0, moved: 0, failed: 0 };
    }
    const docs = await this.docRepo.find();
    const reqs = await this.reqRepo.find();
    const reqMap = new Map(reqs.map((r) => [r.id, r]));
    let migrated = 0;
    let moved = 0;
    let failed = 0;

    for (const doc of docs) {
      const req = reqMap.get(doc.requestId);
      if (!req || !doc.fileKey) continue;
      const desiredPrefix = `docs/${folderName(req)}/`;

      // 1) Ainda no banco (data URI) → sobe pro R2 na pasta amigável.
      if (doc.fileKey.startsWith("data:")) {
        const m = doc.fileKey.match(/^data:(.+?);base64,(.*)$/s);
        if (!m) {
          failed++;
          continue;
        }
        const buffer = Buffer.from(m[2], "base64");
        const key = `${desiredPrefix}${Date.now()}-${doc.filename}`;
        const stored = await this.storage.upload(key, buffer, doc.contentType || m[1]);
        if (stored) {
          doc.fileKey = stored;
          await this.docRepo.save(doc);
          migrated++;
        } else {
          failed++;
        }
        continue;
      }

      // 2) Já no R2 mas em pasta antiga → copia pra amigável e apaga a antiga.
      if (!doc.fileKey.startsWith(desiredPrefix)) {
        const obj = await this.storage.getObject(doc.fileKey);
        if (!obj) {
          failed++;
          continue;
        }
        const newKey = `${desiredPrefix}${Date.now()}-${doc.filename}`;
        const stored = await this.storage.upload(newKey, obj.buffer, obj.contentType);
        if (!stored) {
          failed++;
          continue;
        }
        const oldKey = doc.fileKey;
        doc.fileKey = stored;
        await this.docRepo.save(doc);
        await this.storage.remove(oldKey);
        moved++;
      }
    }
    return { ok: true, migrated, moved, failed };
  }

  /** Resumo das solicitações de uma conversa (progresso recebidos/total). */
  async findByConversation(conversationId: string) {
    const reqs = await this.reqRepo.find({
      where: { conversationId },
      relations: ["documents"],
      order: { createdAt: "DESC" },
    });
    return reqs.map((req) => {
      const checklist = buildChecklist(req);
      const recebidos = checklist.filter((it) => (req.documents || []).some((d) => d.tipo === it.key)).length;
      return {
        id: req.id,
        token: req.token,
        fase: req.fase,
        total: checklist.length,
        recebidos,
        concluido: recebidos === checklist.length,
        createdAt: req.createdAt,
      };
    });
  }
}
