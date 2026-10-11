import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { WhatsappWebhookController } from "./whatsapp-webhook.controller";
import { WhatsappFlowService } from "./whatsapp-flow.service";
import { WebhookAuthGuard } from "./webhook-auth.guard";

// Rota REAL (Express 5 / Nest 11): a base e os sub-paths por evento da Evolution
// precisam chegar no mesmo handler — se quebrar, nenhuma mensagem entra no CRM.
describe("Webhook do WhatsApp — rotas no Express 5", () => {
  let app: INestApplication;
  let base: string;
  const recebidos: any[] = [];

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [WhatsappWebhookController],
      providers: [
        WebhookAuthGuard,
        { provide: WhatsappFlowService, useValue: { handleInbound: async (p: any) => (recebidos.push(p), { ok: true }) } },
        { provide: ConfigService, useValue: { get: (k: string) => (k === "WHATSAPP_WEBHOOK_TOKEN" ? "segredo" : undefined) } },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0);
    base = `${await app.getUrl()}/api/v1/whatsapp/webhook`.replace("[::1]", "localhost");
  });
  afterAll(() => app.close());

  const post = (url: string) =>
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "messages.upsert" }) });

  it("aceita a URL base e os sub-paths por evento (com token)", async () => {
    expect((await post(`${base}?token=segredo`)).status).toBe(200);
    expect((await post(`${base}/messages-upsert?token=segredo`)).status).toBe(200);
    expect((await post(`${base}/connection-update?token=segredo`)).status).toBe(200);
    expect(recebidos).toHaveLength(3);
  });

  it("sem token responde 401", async () => {
    expect((await post(base)).status).toBe(401);
    expect((await post(`${base}/messages-upsert`)).status).toBe(401);
  });
});
