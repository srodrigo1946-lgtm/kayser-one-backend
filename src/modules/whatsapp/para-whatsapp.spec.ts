import { paraWhatsapp } from "./whatsapp-flow.service";

describe("paraWhatsapp", () => {
  it("converte o Markdown da IA pro formato do WhatsApp", () => {
    const ia = [
      "Que ótimo, Rodrigo! 🎉",
      "",
      "---",
      "",
      "📅 **Confirmação de Visita:**",
      "- **Nome:** Rodrigo",
      "- **Data:** Sábado",
      "",
      "---",
      "",
      "",
      "Tem mais alguma dúvida?",
    ].join("\n");
    expect(paraWhatsapp(ia)).toBe(
      ["Que ótimo, Rodrigo! 🎉", "", "📅 *Confirmação de Visita:*", "• *Nome:* Rodrigo", "• *Data:* Sábado", "", "Tem mais alguma dúvida?"].join("\n")
    );
  });

  it("título vira negrito e texto simples não muda", () => {
    expect(paraWhatsapp("### Planta")).toBe("*Planta*");
    expect(paraWhatsapp("Olá! Tudo bem?")).toBe("Olá! Tudo bem?");
  });
});

describe("tag de fotos da IA", () => {
  const svc: any = new (require("./whatsapp-flow.service").WhatsappFlowService)(
    {}, {}, {}, {}, {}, {}, {}
  );
  it("tira [FOTOS: X] do texto e devolve o empreendimento pedido", () => {
    const r = svc.separarFotos("Olha só o Ilha Stay! 😍\n[FOTOS: Ilha Stay Home Resort]\n\nQuer agendar uma visita?");
    expect(r.pedidos).toEqual(["Ilha Stay Home Resort"]);
    expect(r.texto).toBe("Olha só o Ilha Stay! 😍\n\nQuer agendar uma visita?");
  });
  it("sem tag, não pede foto", () => {
    expect(svc.separarFotos("Oi!").pedidos).toEqual([]);
  });
});
