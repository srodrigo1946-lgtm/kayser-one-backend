import { pedeParar } from "./whatsapp.service";

describe("Proteção do WhatsApp — cliente pede pra parar", () => {
  it("reconhece pedidos de parar", () => {
    for (const t of ["pare", "PARE!", "Sair", "não quero mais receber", "nao tenho interesse", "para de me mandar mensagem", "me tira dessa lista", "quero me descadastrar", "não me mande mais nada"]) {
      expect(pedeParar(t)).toBe(true);
    }
  });
  it("não confunde conversa normal", () => {
    for (const t of ["para quando é a entrega?", "quero saber o preço", "pode me mandar as fotos?", "tenho interesse sim", ""]) {
      expect(pedeParar(t)).toBe(false);
    }
  });
});
