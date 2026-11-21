import * as XLSX from "xlsx";
import { campoDoCabecalho } from "./leads.service";

it("CSV em UTF-8 mantém acento e emoji (lido como texto)", () => {
  const buf = Buffer.from("Nome,Ranking cliente\nJosé,Ouro🥇\n", "utf8");
  const wb = XLSX.read(buf.toString("utf8"), { type: "string" });
  const linhas: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  expect(linhas[1]).toEqual(["José", "Ouro🥇"]);
});

describe("Planilha: ranking e CPF do cliente", () => {
  it("lê 'Ranking cliente' e 'CPF' sem confundir com o nome", () => {
    expect(campoDoCabecalho("Ranking cliente")).toBe("ranking");
    expect(campoDoCabecalho("CPF")).toBe("cpf");
    expect(campoDoCabecalho("Cliente")).toBe("name");
  });
});
