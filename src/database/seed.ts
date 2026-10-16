import "reflect-metadata";
import * as dotenv from "dotenv";
import { DataSource } from "typeorm";
import * as bcrypt from "bcryptjs";
import { User, UserRole } from "../modules/users/user.entity";
import { Lead, LeadStatus } from "../modules/leads/lead.entity";
import { Property } from "../modules/properties/property.entity";

dotenv.config();

/**
 * Seed inicial do K1.
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
          entities: [User, Lead, Property],
          synchronize: true,
        }
      : {
          type: "postgres",
          host: process.env.DB_HOST || "localhost",
          port: Number(process.env.DB_PORT || 5432),
          username: process.env.DB_USER || "postgres",
          password: process.env.DB_PASS || "postgres",
          database: process.env.DB_NAME || "kayser_one",
          entities: [User, Lead, Property],
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
    // Cliente novo: senha aleatória posta pelo provisionamento (SEED_DIRETOR_SENHA).
    const senha = process.env.SEED_DIRETOR_SENHA || "123456789";
    const passwordHash = await bcrypt.hash(senha, 12);
    diretor = usersRepo.create({
      name: process.env.SEED_DIRETOR_NAME || "Rodrigo (Diretor)",
      email: diretorEmail,
      passwordHash,
      role: UserRole.DIRETOR,
      active: true,
      firstLogin: true,
    });
    await usersRepo.save(diretor);
    console.log(`✅ Diretor criado: ${diretorEmail}`);
  } else {
    console.log(`ℹ️  Diretor já existe: ${diretorEmail}`);
  }

  // ---- Demonstração (só na instalação demo.kayserone.com.br, SEED_DEMO=true) ----
  if (process.env.SEED_DEMO === "true") await seedDemo(dataSource, diretor);

  await dataSource.destroy();
  console.log("🌱 Seed concluído.");
}

/**
 * Dados FICTÍCIOS para a demonstração de vendas: equipe, imóveis e leads espalhados
 * pelo funil. Roda uma vez (se já houver leads, não faz nada). Nunca ligar em cliente real.
 * Telefones no formato 21 90000-XXXX (não existem); senha da equipe demo: demo1234.
 */
async function seedDemo(ds: DataSource, diretor: User) {
  const leadsRepo = ds.getRepository(Lead);
  if ((await leadsRepo.count()) > 0) {
    console.log("ℹ️  Demo: já tem leads, nada a fazer.");
    return;
  }
  const usersRepo = ds.getRepository(User);
  const senha = await bcrypt.hash("demo1234", 12);
  const novo = async (name: string, email: string, role: UserRole, managerId: string) => {
    const u = usersRepo.create({ name, email, passwordHash: senha, role, managerId, active: true, approved: true, firstLogin: false } as any);
    return (await usersRepo.save(u)) as unknown as User;
  };
  const gerente = await novo("Carla Mendes (Gerente)", "gerente@demo.kayserone.com.br", UserRole.GERENTE, diretor.id);
  const corretores = [
    await novo("Ana Souza", "ana@demo.kayserone.com.br", UserRole.CORRETOR, gerente.id),
    await novo("Bruno Lima", "bruno@demo.kayserone.com.br", UserRole.CORRETOR, gerente.id),
    await novo("Diego Rocha", "diego@demo.kayserone.com.br", UserRole.CORRETOR, gerente.id),
  ];

  const imoveis = ds.getRepository(Property);
  const props = [
    { name: "Residencial Jardins", type: "apartamento", status: "lancamento", construtora: "Construtora Exemplo", priceMin: 289000, priceMax: 420000, bedrooms: 2, cidade: "Rio de Janeiro", bairro: "Barra Olímpica", deliveryDate: "12/2028" },
    { name: "Torre Sul", type: "apartamento", status: "em_obras", construtora: "Construtora Exemplo", priceMin: 350000, priceMax: 610000, bedrooms: 3, cidade: "Rio de Janeiro", bairro: "Recreio", deliveryDate: "06/2028" },
    { name: "Vista Mar Life", type: "apartamento", status: "lancamento", construtora: "Incorporadora Modelo", priceMin: 410000, priceMax: 780000, bedrooms: 3, cidade: "Rio de Janeiro", bairro: "Jacarepaguá", deliveryDate: "03/2029" },
  ];
  for (const p of props) await imoveis.save(imoveis.create({ ...p, active: true } as any));

  const nomes = ["Mariana Alves", "Paulo Ribeiro", "Luiza Martins", "Rafael Costa", "Juliana Pires", "Fernando Dias", "Camila Nunes", "Ricardo Gomes",
    "Patrícia Lopes", "Thiago Freitas", "Beatriz Cunha", "Gustavo Moreira", "Larissa Teixeira", "Eduardo Barros", "Renata Farias", "Marcelo Pinto",
    "Aline Castro", "Vinícius Melo", "Débora Ramos", "Felipe Azevedo", "Natália Duarte", "Rodrigo Campos", "Sabrina Lima", "André Monteiro"];
  const funil = [
    LeadStatus.NOVO_LEAD, LeadStatus.NOVO_LEAD, LeadStatus.NOVO_LEAD, LeadStatus.PRIMEIRO_CONTATO, LeadStatus.PRIMEIRO_CONTATO,
    LeadStatus.EM_ATENDIMENTO, LeadStatus.EM_ATENDIMENTO, LeadStatus.EM_ATENDIMENTO, LeadStatus.AGENDAMENTO, LeadStatus.VISITA_AGENDADA,
    LeadStatus.VISITA_AGENDADA, LeadStatus.VISITA_REALIZADA, LeadStatus.SIMULACAO, LeadStatus.SIMULACAO, LeadStatus.DOCUMENTACAO,
    LeadStatus.SUBIDA_PASTA, LeadStatus.APROVACAO, LeadStatus.VENDA_GANHA, LeadStatus.VENDA_GANHA, LeadStatus.VENDA_PERDIDA,
    LeadStatus.VENDA_PERDIDA, LeadStatus.NOVO_LEAD, LeadStatus.EM_ATENDIMENTO, LeadStatus.VISITA_AGENDADA,
  ];
  const origens = ["Facebook", "Instagram", "WhatsApp", "Formulário", "Site"];
  const hoje = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < nomes.length; i++) {
    const status = funil[i];
    const imovel = props[i % props.length];
    const ganho = status === LeadStatus.VENDA_GANHA;
    await leadsRepo.save(
      leadsRepo.create({
        name: nomes[i],
        phone: `219000${String(1000 + i).padStart(5, "0")}`,
        email: `${nomes[i].split(" ")[0].toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")}@exemplo.com`,
        empreendimento: imovel.name,
        origem: origens[i % origens.length],
        status,
        responsavelId: corretores[i % corretores.length].id,
        score: 40 + ((i * 7) % 55),
        renda: 5000 + ((i * 1300) % 12000),
        ...(ganho ? { valorVenda: imovel.priceMin + 20000 * i, dataVenda: hoje } : {}),
      } as any)
    );
  }
  console.log(`✅ Demo: 1 gerente, ${corretores.length} corretores, ${props.length} imóveis e ${nomes.length} leads fictícios (senha da equipe: demo1234).`);
}

seed().catch((err) => {
  console.error("❌ Erro no seed:", err);
  process.exit(1);
});
