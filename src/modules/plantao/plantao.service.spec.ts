import { distanciaMetros, standMaisPerto, hojeSP, RAIO_CHECKIN, limparEndereco, chaveStand, confereEndereco } from "./plantao.service";

describe("Check-in do plantão (geolocalização)", () => {
  const stand = { nome: "Stand Sky", lat: -22.7556, lng: -43.4603 };

  it("calcula distância em metros", () => {
    expect(distanciaMetros(stand.lat, stand.lng, stand.lat, stand.lng)).toBe(0);
    // ~111 m por 0,001° de latitude
    const d = distanciaMetros(stand.lat, stand.lng, stand.lat + 0.001, stand.lng);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(120);
  });

  it("libera dentro de 200 m e barra longe", () => {
    expect(standMaisPerto(stand.lat + 0.001, stand.lng, [stand])?.dentro).toBe(true); // ~111 m
    expect(standMaisPerto(stand.lat + 0.01, stand.lng, [stand])?.dentro).toBe(false); // ~1,1 km
    expect(RAIO_CHECKIN).toBe(200);
  });

  it("escolhe o stand mais perto", () => {
    const outro = { nome: "Stand Ilha", lat: -23.0, lng: -43.3 };
    expect(standMaisPerto(stand.lat, stand.lng, [outro, stand])?.stand.nome).toBe("Stand Sky");
  });

  it("limpa o endereço pro mapa (Loja A, R., travessão)", () => {
    expect(limparEndereco("R. Lopo Saraiva, 179, Loja A – Pechincha, Rio de Janeiro – RJ")).toBe("Rua Lopo Saraiva, 179 - Pechincha, Rio de Janeiro - RJ");
    expect(limparEndereco("AV Mário Guimarães, 517 – Centro")).toBe("Avenida Mário Guimarães, 517 - Centro");
  });

  it("mesmo stand com endereço escrito diferente", () => {
    const a = chaveStand("Praça Professora Heley Batista, s/n – Barra Olímpica, Rio de Janeiro – RJ, 22783-116");
    expect(a).toBe("praca professora heley batista");
    expect(chaveStand("Praça Professora Heley Batista, s/n – Barra Olímpica, Rio de Janeiro/RJ")).toBe(a);
    expect(chaveStand("R. Lopo Saraiva, 179, Loja A – Pechincha")).not.toBe(a);
  });

  it("recusa resultado do mapa que é outra rua", () => {
    const end = "Praça Professora Heley Batista, s/n – Barra Olímpica, Rio de Janeiro – RJ";
    expect(confereEndereco(end, "Praça Professora Alice Brasil")).toBe(false);
    expect(confereEndereco(end, "Praça Professora Heley Batista, Barra Olímpica")).toBe(true);
    expect(confereEndereco("R. Lopo Saraiva, 179, Loja A – Pechincha", "179, Rua Lopo Saraiva, Pechincha, Rio de Janeiro")).toBe(true);
    expect(confereEndereco("Av. Mário Guimarães, 517 – Centro", "Avenida Mario Guimaraes, Centro, Nova Iguaçu")).toBe(true);
  });

  it("dia em Brasília", () => {
    expect(hojeSP(new Date("2026-10-02T02:00:00Z"))).toBe("2026-10-01"); // 23h em SP
  });
});
