import "reflect-metadata";
import * as dotenv from "dotenv";
import { DataSource } from "typeorm";
import * as bcrypt from "bcrypt";
import { User, UserRole } from "../modules/users/user.entity";
import { Lead, LeadStatus } from "../modules/leads/lead.entity";

dotenv.config();

/**
 * Seed inicial do Kayser One.
 * Cria o usuário Diretor (primeiro acesso com senha padrão 123456789) e,
 * opcionalmente, alguns leads de exemplo para o dashboard não nascer vazio.
 *
 * Uso: npm run seed
 * É idempotente — rodar várias vezes não duplica registros.
 */
async function seed() {
  const dataSource = new DataSource(
    process.env.DATABASE_URL
      ? {
          type: "postgres",
          url: process.env.DATABASE_URL,
          ssl: { rejectUnauthorized: false },
          entities: [User, Lead],
          synchronize: true,
        }
      : {
          type: "postgres",
          host: process.env.DB_HOST || "localhost",
          port: Number(process.env.DB_PORT || 5432),
          username: process.env.DB_USER || "postgres",
          password: process.env.DB_PASS || "postgres",
          database: process.env.DB_NAME || "kayser_one",
          entities: [User, Lead],
          synchronize: true,
        }
  );

  await dataSource.initialize();
  console.log("🔌 Conectado ao banco.");

  const usersRepo = dataSource.getRepository(User);
  const leadsRepo = dataSource.getRepository(Lead);

  // ---- Diretor ----
  const diretorEmail = process.env.SEED_DIRETOR_EMAIL || "srodrigo1946@gmail.com";
  let diretor = await usersRepo.findOne({ where: { email: diretorEmail } });

  if (!diretor) {
    const passwordHash = await bcrypt.hash("123456789", 12);
    diretor = usersRepo.create({
      name: process.env.SEED_DIRETOR_NAME || "Rodrigo (Diretor)",
      email: diretorEmail,
      passwordHash,
      role: UserRole.DIRETOR,
      active: true,
      firstLogin: true,
    });
    await usersRepo.save(diretor);
    console.log(`✅ Diretor criado: ${diretorEmail} (senha padrão: 123456789)`);
  } else {
    console.log(`ℹ️  Diretor já existe: ${diretorEmail}`);
  }

  // ---- Leads de exemplo (apenas se a base estiver vazia) ----
  const leadCount = await leadsRepo.count();
  if (leadCount === 0) {
    const exemplos: Partial<Lead>[] = [
      { name: "Maria Silva", phone: "11988887777", cidade: "São Paulo", empreendimento: "Park Village", origem: "Meta Ads", renda: 4500, status: LeadStatus.NOVO_LEAD, responsavelId: diretor.id },
      { name: "João Souza", phone: "11977776666", cidade: "Guarulhos", empreendimento: "Novolar Penha", origem: "Google Ads", renda: 3200, status: LeadStatus.PRIMEIRO_CONTATO, responsavelId: diretor.id },
      { name: "Ana Costa", phone: "11966665555", cidade: "Osasco", empreendimento: "Park Village", origem: "Indicação", renda: 6000, status: LeadStatus.EM_ATENDIMENTO, responsavelId: diretor.id },
      { name: "Carlos Lima", phone: "11955554444", cidade: "São Paulo", empreendimento: "Novolar Penha", origem: "Portal", renda: 5200, status: LeadStatus.VISITA_AGENDADA, responsavelId: diretor.id },
      { name: "Fernanda Rocha", phone: "11944443333", cidade: "Barueri", empreendimento: "Park Village", origem: "Meta Ads", renda: 8000, status: LeadStatus.VENDA_GANHA, responsavelId: diretor.id },
    ];
    await leadsRepo.save(exemplos.map((e) => leadsRepo.create(e)));
    console.log(`✅ ${exemplos.length} leads de exemplo criados.`);
  } else {
    console.log(`ℹ️  ${leadCount} leads já existem — pulando exemplos.`);
  }

  await dataSource.destroy();
  console.log("🌱 Seed concluído.");
}

seed().catch((err) => {
  console.error("❌ Erro no seed:", err);
  process.exit(1);
});
