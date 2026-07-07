import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("properties")
export class Property {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  // Nome do empreendimento/imóvel
  @Column()
  name: string;

  // apartamento | casa | lote | comercial | sala | cobertura
  @Column({ default: "apartamento" })
  type: string;

  // lancamento | em_obra | pronto | entregue
  @Column({ default: "lancamento" })
  status: string;

  @Column({ nullable: true })
  construtora: string;

  @Column({ type: "text", nullable: true })
  description: string;

  // VGV — Valor Geral de Vendas
  @Column({ type: "float", nullable: true })
  vgv: number;

  // Localização
  @Column({ nullable: true })
  address: string;
  @Column({ nullable: true })
  bairro: string;
  @Column({ nullable: true })
  cidade: string;
  @Column({ nullable: true })
  estado: string;
  @Column({ nullable: true })
  cep: string;

  // Unidades
  @Column({ type: "int", default: 0 })
  totalUnits: number;
  @Column({ type: "int", default: 0 })
  availableUnits: number;

  // Faixa de preço e área (m²)
  @Column({ type: "float", nullable: true })
  priceMin: number;
  @Column({ type: "float", nullable: true })
  priceMax: number;
  @Column({ type: "float", nullable: true })
  areaMin: number;
  @Column({ type: "float", nullable: true })
  areaMax: number;

  @Column({ type: "int", nullable: true })
  bedrooms: number;
  @Column({ type: "int", nullable: true })
  parkingSpots: number;

  // Comodidades (piscina, academia, etc.)
  @Column({ type: "simple-array", nullable: true })
  amenities: string[];

  // URL de capa opcional (link externo)
  @Column({ type: "text", nullable: true })
  imageUrl: string;

  // Galeria de fotos do empreendimento (URLs ou data URIs). jsonb aceita vírgulas/base64.
  @Column({ type: "jsonb", nullable: true })
  photos: string[];

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
