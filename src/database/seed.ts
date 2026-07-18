import "reflect-metadata";
import * as dotenv from "dotenv";
import { DataSource } from "typeorm";
import * as bcrypt from "bcrypt";
import { User, UserRole } from "../modules/users/user.entity";
import { Lead } from "../modules/leads/lead.entity";

dotenv.config();

/**
 * Seed inicial do Kayser One.
 * Cria APENAS o usuário Diretor (primeiro acesso com senha padrão 123456789).
 * NÃO cria leads de exemplo (nada de dados/telefones fake em produção).
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

  await dataSource.destroy();
  console.log("🌱 Seed concluído.");
}

seed().catch((err) => {
  console.error("❌ Erro no seed:", err);
  process.exit(1);
});
