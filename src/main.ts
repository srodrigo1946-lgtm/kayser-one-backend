import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { json, urlencoded } from "express";
import helmet from "helmet";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const isProd = process.env.NODE_ENV === "production";

  // Cabeçalhos de segurança (HSTS, no-sniff, sem frame, etc.). É uma API JSON,
  // então desligamos a CSP (que atrapalharia o Swagger em dev e não protege JSON).
  // CORP em "cross-origin": o backend serve avatares/mídia por <img> a partir do
  // frontend (outro domínio); o padrão "same-origin" do Helmet bloquearia isso.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    })
  );

  // Webhooks da Evolution API mandam payloads grandes (base64 de mídia/QR),
  // que estouram o limite padrão de 100kb do Express. Aumentamos o limite.
  app.use(json({ limit: "25mb" }));
  app.use(urlencoded({ extended: true, limit: "25mb" }));

  app.setGlobalPrefix("api/v1");

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    })
  );

  // CORS: aceita MÚLTIPLOS endereços (o app é acessado pelo domínio próprio E pelo
  // *.vercel.app). Origens extras podem ser adicionadas via env CORS_ORIGINS (CSV).
  const allowedOrigins = [
    ...(process.env.CORS_ORIGINS || "").split(",").map((s) => s.trim()),
    process.env.FRONTEND_URL,
    "https://kayserone.com.br",
    "https://www.kayserone.com.br",
    "https://kayser-one-frontend.vercel.app",
    "http://localhost:3000",
  ].filter(Boolean);
  app.enableCors({
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
      // Requests sem Origin (curl, apps mobile, webhooks) e origens permitidas passam.
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`Origem não permitida pelo CORS: ${origin}`));
    },
    credentials: true,
  });

  // Swagger só fora de produção — não expor o mapa da API publicamente.
  if (!isProd) {
    const config = new DocumentBuilder()
      .setTitle("Kayser One API")
      .setDescription("CRM Inteligente com IA para Gestão Comercial")
      .setVersion("1.0")
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("api/docs", app, document);
  }

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`🚀 Kayser One API rodando em: http://localhost:${port}`);
  console.log(`📚 Swagger Docs: http://localhost:${port}/api/docs`);
}

bootstrap();
