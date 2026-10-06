import { classificarResposta, mensagemReengajar } from "./reengajamento.service";

describe("Reengajamento dos clientes 'sem interesse'", () => {
  it("entende NÃO (sai do Kayser)", () => {
    for (const t of ["Não", "nao obrigado", "Não tenho interesse", "já comprei", "pare", "não quero mais receber mensagem"]) {
      expect(classificarResposta(t)).toBe("nao");
    }
  });
  it("entende SIM (vai pra fila)", () => {
    for (const t of ["Sim", "tenho interesse", "quero saber", "pode mandar", "me conta", "Opa, quais as condições?"]) {
      expect(classificarResposta(t)).toBe("sim");
    }
  });
  it("o resto segue a conversa normal", () => {
    expect(classificarResposta("quem é?")).toBe("outro");
    expect(classificarResposta("")).toBe("outro");
  });
  it("mensagens variam, usam o primeiro nome e oferecem sair", () => {
    const a = mensagemReengajar("maria silva", "Ilhamar", 0);
    const b = mensagemReengajar("maria silva", "Ilhamar", 1);
    expect(a).not.toBe(b);
    expect(a).toContain("Maria");
    expect(a).toContain("Ilhamar");
    expect(a).toContain("responder NÃO");
  });
});
