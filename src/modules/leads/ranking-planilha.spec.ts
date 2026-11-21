import { campoDoCabecalho } from "./leads.service";

describe("Planilha: ranking e CPF do cliente", () => {
  it("lê 'Ranking cliente' e 'CPF' sem confundir com o nome", () => {
    expect(campoDoCabecalho("Ranking cliente")).toBe("ranking");
    expect(campoDoCabecalho("CPF")).toBe("cpf");
    expect(campoDoCabecalho("Cliente")).toBe("name");
  });
});
