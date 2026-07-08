import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { DocumentRequest } from "./document-request.entity";

@Entity("documents")
export class Document {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  requestId: string;

  @ManyToOne(() => DocumentRequest, (r) => r.documents, { onDelete: "CASCADE" })
  @JoinColumn({ name: "requestId" })
  request: DocumentRequest;

  // Tipo do documento (rg_cnh, comprovante_residencia, contracheque, extrato, ir, certidao_*)
  @Column()
  tipo: string;

  // Nome final: Nome_Telefone_AAAA-MM-DD_tipo.ext
  @Column()
  filename: string;

  // Chave no R2 (S3) ou data URI (fallback quando o storage está desativado).
  @Column({ type: "text" })
  fileKey: string;

  @Column({ nullable: true })
  contentType: string;

  @CreateDateColumn()
  uploadedAt: Date;
}
