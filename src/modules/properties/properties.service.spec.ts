import { PropertiesService } from "./properties.service";

describe("PropertiesService.update — coordenada do stand", () => {
  const montar = (atual: any) => {
    const repo: any = {
      findOne: jest.fn().mockResolvedValue({ ...atual }),
      save: jest.fn((p) => Promise.resolve(p)),
    };
    return new PropertiesService(repo);
  };
  const base = { id: "p1", standAddress: "Rua A, 10", standLat: -22.9, standLng: -43.2 };

  it("zera a coordenada quando o endereço do stand muda", async () => {
    const p: any = await montar(base).update("p1", { standAddress: "Rua B, 20" });
    expect(p.standLat).toBeNull();
    expect(p.standLng).toBeNull();
  });

  it("mantém a coordenada quando o endereço é o mesmo ou não veio", async () => {
    const igual: any = await montar(base).update("p1", { standAddress: " Rua A, 10 ", name: "X" });
    expect(igual.standLat).toBe(-22.9);
    const semCampo: any = await montar(base).update("p1", { name: "X" });
    expect(semCampo.standLng).toBe(-43.2);
  });
});
