import { detectarEmpreendimento } from "./knowledge.service";

const props = [
  "Ilha stay home Resort",
  "Ilhamar Beach e Home",
  "Oceanside Recreio",
  "Vibe Barra",
  "BeOn Porto Residencial",
  "Villa Santé",
  "Marine Barra Residence",
  "Renascença Residencial",
  "Sky Mário Guimarães",
].map((name) => ({ name }));

const qual = (t: string) => detectarEmpreendimento(t, props)?.name ?? null;

describe("detectarEmpreendimento", () => {
  it("acha pelo começo do nome, sem acento e sem maiúscula", () => {
    expect(qual("Quero mais informações ilha stay")).toBe("Ilha stay home Resort");
    expect(qual("valor do renascenca?")).toBe("Renascença Residencial");
    expect(qual("tem planta do Villa Sante")).toBe("Villa Santé");
    expect(qual("e o sky mario guimaraes em nova iguaçu")).toBe("Sky Mário Guimarães");
  });
  it("não confunde Ilhamar com Ilha Stay", () => {
    expect(qual("quero saber do ilhamar")).toBe("Ilhamar Beach e Home");
    expect(qual("fotos do Ilha Stay por favor")).toBe("Ilha stay home Resort");
  });
  it("palavra genérica sozinha não registra", () => {
    expect(qual("moro na barra da tijuca")).toBeNull();
    expect(qual("oi boa noite")).toBeNull();
  });
});
