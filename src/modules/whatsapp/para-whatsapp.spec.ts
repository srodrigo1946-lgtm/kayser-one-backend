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
