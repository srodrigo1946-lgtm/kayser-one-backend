import { distanciaMetros, standMaisPerto, hojeSP, RAIO_CHECKIN, limparEndereco, chaveStand, confereEndereco, escolherTurno, PlantaoService, bloqueiosEfetivos, ordemSorteio } from "./plantao.service";

describe("Check-in do plantão (geolocalização)", () => {
  const stand = { nome: "Stand Sky", lat: -22.7556, lng: -43.4603 };

  it("calcula distância em metros", () => {
    expect(distanciaMetros(stand.lat, stand.lng, stand.lat, stand.lng)).toBe(0);
    // ~111 m por 0,001° de latitude
    const d = distanciaMetros(stand.lat, stand.lng, stand.lat + 0.001, stand.lng);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(120);
  });

  it("libera dentro de 500 m e barra longe", () => {
    expect(standMaisPerto(stand.lat + 0.001, stand.lng, [stand])?.dentro).toBe(true); // ~111 m
    expect(standMaisPerto(stand.lat + 0.02, stand.lng, [stand])?.dentro).toBe(false); // ~2,2 km
    expect(RAIO_CHECKIN).toBe(500);
    expect(standMaisPerto(stand.lat + 0.004, stand.lng, [stand])?.dentro).toBe(true); // ~445 m
    expect(standMaisPerto(stand.lat + 0.0125, stand.lng, [stand])?.dentro).toBe(false); // ~1,4 km
    expect(standMaisPerto(stand.lat + 0.004, stand.lng, [stand])?.dentro).toBe(true); // ~445 m
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

  it("prazo do check-in: até a hora do início (09:00 ok, 09:01 não)", () => {
    const manha = { id: "m", horaInicio: "09:00", horaFim: "13:00" };
    const tarde = { id: "t", horaInicio: "13:00", horaFim: "17:00" };
    expect(escolherTurno([manha], "07:59")).toBeNull(); // cedo demais
    expect(escolherTurno([manha], "08:00")).toEqual({ turno: manha, janela: "aberta" });
    expect(escolherTurno([manha], "09:00")).toEqual({ turno: manha, janela: "aberta" });
    expect(escolherTurno([manha], "09:01")).toEqual({ turno: manha, janela: "fechada" });
    expect(escolherTurno([manha], "13:00")).toBeNull(); // turno acabou
    // nos dois turnos: 12:30 já é o check-in da tarde
    expect(escolherTurno([manha, tarde], "12:30")?.turno.id).toBe("t");
  });

  describe("quem a fila usa no turno (livre x escala, bloqueios)", () => {
    const turno = { id: "T", atendenteIds: ["A", "B"] };
    const montar = (livreDesde: string | null, bloqueados: string[]) =>
      new PlantaoService(
        { find: async () => [{ userId: "C" }, { userId: "A" }, { userId: "D" }] } as any, // check-ins (ordem de chegada)
        { find: async () => [{ standAddress: "Rua X, 1", standLat: -22.9 }] } as any, // stands todos localizados
        { find: async () => [] } as any,
        { find: async () => bloqueados.map((userId) => ({ userId })) } as any,
        {} as any, // tentativas
        {} as any,
        { get: async () => ({ checkinObrigatorio: true, plantaoLivreDesde: livreDesde }) } as any,
        {} as any
      );

    it("escala antiga: só quem é da escala e fez check-in", async () => {
      expect(await montar(null, []).idsDoTurno(turno)).toEqual(["A"]);
    });

    it("plantão livre: qualquer um que fez check-in, menos bloqueados (ordem sorteada)", async () => {
      const ids = await montar("2026-01-01", ["D"]).idsDoTurno(turno);
      expect([...ids].sort()).toEqual(["A", "C"]);
      expect(ids).toEqual(ordemSorteio(["C", "A"], "T" + hojeSP()));
    });

    it("livre marcado pra amanhã ainda usa a escala", async () => {
      expect(await montar("2999-01-01", []).idsDoTurno(turno)).toEqual(["A"]);
    });
  });

  it("sorteio: estável no turno, muda entre turnos, quem chega depois só se encaixa", () => {
    const ids = Array.from({ length: 12 }, (_, i) => "c" + i);
    const a = ordemSorteio(ids, "T1-2026-10-03");
    expect(ordemSorteio([...ids].reverse(), "T1-2026-10-03")).toEqual(a); // não depende da ordem de chegada
    expect(ordemSorteio(ids, "T2-2026-10-03")).not.toEqual(a); // outro turno, outra ordem
    const comNovo = ordemSorteio([...ids, "novo"], "T1-2026-10-03").filter((x) => x !== "novo");
    expect(comNovo).toEqual(a); // os de antes mantêm a ordem
  });

  describe("gerente bloqueia/desbloqueia o time dele", () => {
    const gerente = { id: "G", name: "Gerente Ana", role: "gerente" } as any;
    const diretor = { id: "D", name: "Rodrigo", role: "diretor" } as any;
    const montar = (linhas: any[]) => {
      const repo = {
        findOne: async ({ where }: any) => linhas.find((l) => l.userId === where.userId) ?? null,
        create: (x: any) => x,
        save: async (x: any) => (linhas.push(x), x),
        delete: async ({ userId }: any) => linhas.splice(linhas.findIndex((l) => l.userId === userId), 1),
      };
      const users = { getScopeIds: async (u: any) => (u.role === "diretor" ? null : ["G", "C1", "C2"]) };
      return new PlantaoService({} as any, {} as any, {} as any, repo as any, {} as any, {} as any, {} as any, users as any);
    };

    it("bloqueia e desbloqueia corretor do time", async () => {
      const linhas: any[] = [];
      const s = montar(linhas);
      await s.bloquear(gerente, "C1");
      expect(linhas).toEqual([expect.objectContaining({ userId: "C1", porNome: "Gerente Ana", porDiretor: false })]);
      await s.desbloquear(gerente, "C1");
      expect(linhas).toEqual([]);
    });

    it("não mexe em quem é de fora do time nem em si mesmo", async () => {
      const s = montar([]);
      await expect(s.bloquear(gerente, "X")).rejects.toThrow("não é da sua equipe");
      await expect(s.bloquear(gerente, "G")).rejects.toThrow("não pode se bloquear");
    });

    it("bloqueio do Diretor só o Diretor desbloqueia", async () => {
      const linhas: any[] = [];
      const s = montar(linhas);
      await s.bloquear(diretor, "C2");
      await expect(s.desbloquear(gerente, "C2")).rejects.toThrow("só ele desbloqueia");
      await s.desbloquear(diretor, "C2");
      expect(linhas).toEqual([]);
    });
  });

  it("bloquear o gerente bloqueia o time todo (cascata)", () => {
    const users = [
      { id: "G", managerId: "D", name: "Gerente Ana" },
      { id: "C1", managerId: "G" },
      { id: "Co", managerId: "G" }, // coordenador
      { id: "C2", managerId: "Co" },
      { id: "X", managerId: "D" }, // outro time
    ];
    const m = bloqueiosEfetivos(users, [{ userId: "G", porNome: "Rodrigo", porDiretor: true }]);
    expect([...m.keys()].sort()).toEqual(["C1", "C2", "Co", "G"]);
    expect(m.get("G")?.via).toBeNull();
    expect(m.get("C2")?.via).toBe("Gerente Ana");
    expect(m.has("X")).toBe(false);
  });

  it("check-in que falha fica gravado como tentativa (com distância)", async () => {
    const salvos: any[] = [];
    const s = new PlantaoService(
      { findOne: async () => null } as any,
      { find: async () => [{ id: "P", name: "Villa Santé", standAddress: "Rua X", standLat: -22.9269, standLng: -43.3597, active: true }] } as any,
      {} as any,
      { find: async () => [] } as any,
      { create: (x: any) => x, save: async (x: any) => (salvos.push(x), x) } as any,
      { turnosDoDia: async () => ({ hhmm: "08:30", turnos: [{ id: "T", horaInicio: "09:00", horaFim: "12:00", atendenteIds: ["U"] }] }) } as any,
      { get: async () => ({ checkinObrigatorio: true }) } as any,
      {} as any
    );
    const user = { id: "U", name: "Ana", role: "corretor" } as any;
    await expect(s.checkin(user, -22.95, -43.3597, 12)).rejects.toThrow("Chegue no stand");
    expect(salvos).toEqual([expect.objectContaining({ userId: "U", standNome: "Villa Santé", precisao: 12 })]);
    expect(salvos[0].distancia).toBeGreaterThan(2000);
    expect(salvos[0]).toEqual(expect.objectContaining({ lat: -22.95, lng: -43.3597, propertyId: "P" }));
  });

  it("centro do stand pelos check-ins: mediana, 1 ponto por pessoa, ignora quem estava longe", () => {
    const { centroDosCheckins } = require("./plantao.service");
    const c = centroDosCheckins([
      { userId: "a", lat: -22.9, lng: -43.2, precisao: 10 },
      { userId: "a", lat: -22.8, lng: -43.1, precisao: 25 }, // mesmo corretor, pior GPS: ignorado
      { userId: "b", lat: -22.9002, lng: -43.2001, precisao: 12 },
      { userId: "c", lat: -22.95, lng: -43.25, precisao: 9 }, // estava longe
    ]);
    expect(c.pessoas).toBe(3);
    expect(c.lat).toBe(-22.9002);
    expect(c.lng).toBe(-43.2001);
    expect(centroDosCheckins([{ userId: "a", lat: 1, lng: 1, precisao: 5 }])).toBeNull();
  });

  it("dia em Brasília", () => {
    expect(hojeSP(new Date("2026-10-02T02:00:00Z"))).toBe("2026-10-01"); // 23h em SP
  });
});

describe("Plantão — saiu do stand depois do check-in", () => {
  const { longeDoStand, turnoLivreDoStand, SAIDA_LEITURAS, PlantaoService: Svc } = require("./plantao.service");

  it("longe = passou de 500 m, descontando o erro do GPS (até 100 m); GPS muito ruim não conta", () => {
    expect(longeDoStand(450, 10)).toBe(false);
    expect(longeDoStand(560, 80)).toBe(false); // 560 - 80 = 480: pode ser erro do GPS
    expect(longeDoStand(700, 300)).toBeNull(); // precisão ruim: ignora a leitura
    expect(longeDoStand(800, 20)).toBe(true);
    expect(longeDoStand(650, 500)).toBeNull();
  });

  it("o plantão das 21h não entra na regra", () => {
    expect(turnoLivreDoStand("21:00")).toBe(true);
    expect(turnoLivreDoStand("09:00")).toBe(false);
    expect(turnoLivreDoStand("15:00")).toBe(false);
  });

  const montar = (horaInicio: string, ck: any) => {
    const updates: any[] = [];
    const checkins = { findOne: async () => (ck ? { ...ck, saiuEm: ck.saiuEm ?? null } : null), update: async (id: string, d: any) => { updates.push({ id, ...d }); if (ck) Object.assign(ck, d); } };
    const props = { findOne: async () => ({ id: "p1", standLat: -23.0, standLng: -43.3 }) };
    const escala = { turnoAtivo: async () => ({ id: "t1", horaInicio }) };
    const s = new Svc(checkins as any, props as any, {} as any, {} as any, {} as any, escala as any, {} as any, {} as any);
    return { s, updates };
  };
  const longe = { lat: -23.02, lng: -43.3 }; // ~2,2 km do stand
  const perto = { lat: -23.001, lng: -43.3 }; // ~110 m

  it(`sai do plantão depois de ${SAIDA_LEITURAS} leituras seguidas longe (uma volta pra perto zera)`, async () => {
    const ck = { id: "c1", propertyId: "p1", standNome: "Stand", saiuEm: null };
    const { s, updates } = montar("09:00", ck);
    const u = { id: "u1", name: "Ana" } as any;
    expect((await s.posicao(u, longe.lat, longe.lng, 10)).status).toBe("aviso");
    expect((await s.posicao(u, perto.lat, perto.lng, 10)).status).toBe("ok"); // voltou: zera
    expect((await s.posicao(u, longe.lat, longe.lng, 10)).status).toBe("aviso");
    expect((await s.posicao(u, longe.lat, longe.lng, 10)).status).toBe("saiu");
    expect(updates[0]).toEqual(expect.objectContaining({ id: "c1", saiuEm: expect.any(Date) }));
  });

  it("no plantão das 21h pode sair do stand à vontade", async () => {
    const { s, updates } = montar("21:00", { id: "c1", propertyId: "p1", standNome: "Stand" });
    for (let i = 0; i < 3; i++) expect((await s.posicao({ id: "u1" } as any, longe.lat, longe.lng, 10)).status).toBe("livre");
    expect(updates).toHaveLength(0);
  });

  it("check-in liberado à mão (sem stand) não é acompanhado", async () => {
    const { s, updates } = montar("09:00", { id: "c1", propertyId: null, standNome: "Liberado por X" });
    expect((await s.posicao({ id: "u1" } as any, longe.lat, longe.lng, 10)).status).toBe("sem-checkin");
    expect(updates).toHaveLength(0);
  });
});
