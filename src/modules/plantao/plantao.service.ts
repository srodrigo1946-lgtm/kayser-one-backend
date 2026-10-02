import { BadRequestException, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, IsNull, Not, Repository } from "typeorm";
import { Cron } from "@nestjs/schedule";
import { PlantaoCheckin } from "./plantao-checkin.entity";
import { Property } from "../properties/property.entity";
import { User, UserRole } from "../users/user.entity";
import { EscalaService } from "../escala/escala.service";
import { SettingsService } from "../settings/settings.service";

/** Raio do check-in (m) — pedido do Rodrigo: 200 m. */
export const RAIO_CHECKIN = 200;

/** Distância em metros entre dois pontos (fórmula de Haversine). */
export function distanciaMetros(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

/** Dia de hoje em Brasília (YYYY-MM-DD). */
export function hojeSP(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
}

/**
 * Limpa o endereço pro serviço de mapa: tira "Loja A"/"Sala 3"/"Bloco B", expande
 * "R." → "Rua", "Av." → "Avenida", "Estr." → "Estrada", troca travessões.
 */
export function limparEndereco(e: string): string {
  return (e || "")
    .replace(/[–—]/g, "-")
    .replace(/,?\s*\b(loja|lj|sala|sl|bloco|bl|lote|qd|quadra|apto|ap)\.?\s*[\w-]+/gi, "")
    .replace(/\bR\.\s*/g, "Rua ")
    .replace(/\bAv\.?\s+/gi, "Avenida ")
    .replace(/\bEstr\.?\s+/gi, "Estrada ")
    .replace(/\bPça\.?\s+/gi, "Praça ")
    .replace(/\s*,\s*,/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

const semAcento = (t: string) => (t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Identidade do stand: rua/praça sem número, "s/n", acento e pontuação.
 * "Praça Professora Heley Batista, s/n – Barra…" e "…, s/n – Barra…/RJ" = mesmo stand.
 */
export function chaveStand(endereco: string): string {
  return semAcento(limparEndereco(endereco).split(/\s-\s/)[0])
    .replace(/\bs\/?n\b/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b\d+\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * O resultado do mapa é mesmo essa rua? Todas as palavras "de verdade" do nome
 * (ex.: "heley", "batista") têm que aparecer — evita pegar outra praça qualquer.
 */
export function confereEndereco(endereco: string, resultado: string): boolean {
  const genericas = new Set(["rua", "avenida", "praca", "estrada", "travessa", "alameda", "largo", "rodovia", "professor", "professora", "doutor", "doutora", "das", "dos", "del"]);
  const palavras = chaveStand(endereco).split(" ").filter((w) => w.length >= 3 && !genericas.has(w));
  const r = semAcento(resultado);
  return palavras.length > 0 && palavras.every((w) => r.includes(w));
}

/** Stand mais perto + se está dentro do raio (tolera até 50 m de erro do GPS). */
export function standMaisPerto<T extends { lat: number; lng: number }>(
  lat: number,
  lng: number,
  stands: T[],
  precisao = 0
): { stand: T; distancia: number; dentro: boolean } | null {
  let melhor: { stand: T; distancia: number } | null = null;
  for (const s of stands) {
    const d = distanciaMetros(lat, lng, s.lat, s.lng);
    if (!melhor || d < melhor.distancia) melhor = { stand: s, distancia: d };
  }
  if (!melhor) return null;
  const folga = Math.min(Math.max(precisao || 0, 0), 50);
  return { ...melhor, dentro: melhor.distancia <= RAIO_CHECKIN + folga };
}

type Stand = { propertyId: string; nome: string; endereco: string; lat: number; lng: number };

@Injectable()
export class PlantaoService implements OnModuleInit {
  private readonly logger = new Logger(PlantaoService.name);

  constructor(
    @InjectRepository(PlantaoCheckin) private readonly checkins: Repository<PlantaoCheckin>,
    @InjectRepository(Property) private readonly props: Repository<Property>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly escala: EscalaService,
    private readonly settings: SettingsService
  ) {}

  onModuleInit() {
    // Localiza os stands que ainda não têm coordenada (sem travar o boot).
    setTimeout(() => this.localizarStands().catch(() => {}), 20_000);
  }

  /** Stands = imóveis ativos com endereço de stand já LOCALIZADO no mapa. */
  async stands(): Promise<Stand[]> {
    const ps = await this.props.find({ where: { active: true, standLat: Not(IsNull()) } as any });
    return ps
      .filter((p) => p.standLat != null && p.standLng != null)
      .map((p) => ({ propertyId: p.id, nome: p.name, endereco: p.standAddress || "", lat: Number(p.standLat), lng: Number(p.standLng) }));
  }

  /** A regra do check-in só vale quando existe pelo menos um stand localizado. */
  async exigeCheckin(): Promise<boolean> {
    const s: any = await this.settings.get().catch(() => null);
    if (s && s.checkinObrigatorio === false) return false; // Diretor desligou a regra
    const { total, faltam } = await this.contagemStands();
    // Só vale quando TODOS os stands estão no mapa — senão o corretor de um stand ainda
    // sem localização ficaria sem conseguir check-in (e sem lead).
    return total > 0 && faltam === 0;
  }

  /** Quantos stands (endereço de stand dos imóveis ativos) existem e quantos faltam localizar. */
  private async contagemStands(): Promise<{ total: number; faltam: number }> {
    const ps = await this.props.find({ where: { active: true } });
    const comStand = ps.filter((p) => (p.standAddress || "").trim());
    return { total: comStand.length, faltam: comStand.filter((p) => p.standLat == null).length };
  }

  /** Busca a coordenada de um endereço (OpenStreetMap/Nominatim). */
  private async geocodificar(
    endereco: string,
    extra: { cep?: string; cidade?: string; estado?: string } = {}
  ): Promise<{ lat: number; lng: number } | null> {
    const limpo = limparEndereco(endereco);
    // "Rua Lopo Saraiva, 179" (antes do bairro) pra busca estruturada com CEP/cidade.
    const ruaNum = limpo.split(/\s-\s/)[0].trim();
    const tentativas: string[] = [];
    if (extra.cep || extra.cidade) {
      tentativas.push(
        `STRUCT:street=${encodeURIComponent(ruaNum)}${extra.cidade ? `&city=${encodeURIComponent(extra.cidade)}` : ""}${extra.estado ? `&state=${encodeURIComponent(extra.estado)}` : ""}${extra.cep ? `&postalcode=${encodeURIComponent(extra.cep)}` : ""}&country=Brasil`
      );
    }
    tentativas.push(limpo, limpo.replace(/,?\s*-?\s*[A-Z]{2}\s*$/, ""));
    if (extra.cidade) tentativas.push(`${ruaNum}, ${extra.cidade}${extra.estado ? " - " + extra.estado : ""}`);
    for (const q of tentativas) {
      try {
        const url = q.startsWith("STRUCT:")
          ? `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&${q.slice(7)}`
          : `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(q)}`;
        const r = await fetch(url, { headers: { "User-Agent": "KayserOneCRM/1.0 (stands de plantao)", "Accept-Language": "pt-BR" } });
        if (r.ok) {
          const j: any[] = await r.json();
          if (j?.[0]?.lat && confereEndereco(endereco, j[0].display_name || "")) return { lat: Number(j[0].lat), lng: Number(j[0].lon) };
        }
      } catch {
        /* tenta a próxima */
      }
      await new Promise((res) => setTimeout(res, 1100)); // Nominatim: 1 consulta/s
    }
    // 2ª tentativa: Photon (OpenStreetMap, aceita endereço mais "solto").
    try {
      const r = await fetch(`https://photon.komoot.io/api/?limit=1&lang=pt&q=${encodeURIComponent(limpo + (extra.cidade && !limpo.includes(extra.cidade) ? ", " + extra.cidade : "") + ", Brasil")}`, {
        headers: { "User-Agent": "KayserOneCRM/1.0 (stands de plantao)" },
      });
      if (r.ok) {
        const j: any = await r.json();
        const c = j?.features?.[0]?.geometry?.coordinates;
        const pr = j?.features?.[0]?.properties || {};
        const pais = pr.countrycode;
        if (Array.isArray(c) && (!pais || pais === "BR") && confereEndereco(endereco, `${pr.name || ""} ${pr.street || ""}`))
          return { lat: Number(c[1]), lng: Number(c[0]) };
      }
    } catch {
      /* sem localização */
    }
    return null;
  }

  /** Localiza no mapa os stands (endereço de stand dos imóveis) ainda sem coordenada. */
  async localizarStands(): Promise<{ localizados: number; semLocalizacao: string[] }> {
    const ps = await this.props.find({ where: { active: true } });
    const pendentes = ps.filter((p) => (p.standAddress || "").trim() && p.standLat == null);
    let localizados = 0;
    const semLocalizacao: string[] = [];
    const cache = new Map<string, { lat: number; lng: number } | null>();
    // Stand já localizado (ex.: Diretor colou do Maps) vale pros outros imóveis do mesmo stand.
    for (const p of ps) if (p.standLat != null && p.standAddress) cache.set(chaveStand(p.standAddress), { lat: p.standLat, lng: p.standLng });
    for (const p of pendentes) {
      const end = p.standAddress.trim();
      const k = chaveStand(end);
      if (!cache.has(k)) {
        cache.set(k, await this.geocodificar(end, { cep: p.cep, cidade: p.cidade, estado: p.estado }));
        await new Promise((res) => setTimeout(res, 1100));
      }
      const c = cache.get(k);
      if (c) {
        await this.props.update(p.id, { standLat: c.lat, standLng: c.lng } as any);
        localizados++;
      } else semLocalizacao.push(p.name);
    }
    if (pendentes.length) this.logger.log(`Stands: ${localizados} localizado(s); sem localização: ${semLocalizacao.join(", ") || "nenhum"}.`);
    return { localizados, semLocalizacao };
  }

  @Cron("30 6 * * *", { timeZone: "America/Sao_Paulo" })
  async localizarStandsDiario() {
    await this.localizarStands().catch(() => {});
  }

  /** Diretor no stand: grava a localização exata do stand (mais preciso que o endereço). */
  async definirLocalizacao(propertyId: string, lat: number, lng: number) {
    if (!isFinite(lat) || !isFinite(lng)) throw new BadRequestException("Localização inválida.");
    const p = await this.props.findOne({ where: { id: propertyId } });
    if (!p) throw new BadRequestException("Imóvel não encontrado.");
    // Mesmo endereço de stand = mesmo stand: atualiza todos os imóveis daquele stand.
    const k = p.standAddress ? chaveStand(p.standAddress) : "";
    const iguais = k
      ? (await this.props.find()).filter((x) => x.standAddress && chaveStand(x.standAddress) === k).map((x) => x.id)
      : [p.id];
    await this.props.update({ id: In(iguais) }, { standLat: lat, standLng: lng } as any);
    return { ok: true, atualizados: iguais.length };
  }

  /** Painel do Diretor: imóveis com stand, se já estão no mapa, e os check-ins do turno. */
  async painel() {
    const ps = await this.props.find({ where: { active: true }, order: { name: "ASC" } });
    const stands = ps
      .filter((p) => (p.standAddress || "").trim())
      .map((p) => ({
        propertyId: p.id,
        nome: p.name,
        endereco: p.standAddress,
        localizado: p.standLat != null,
        lat: p.standLat ?? null,
        lng: p.standLng ?? null,
      }));
    const data = hojeSP();
    const cks = await this.checkins.find({ where: { data }, order: { createdAt: "ASC" } });
    const nomes = new Map(
      (cks.length ? await this.users.find({ where: { id: In(cks.map((c) => c.userId)) } }) : []).map((u) => [u.id, u.name])
    );
    const turno = await this.escala.turnoAtivo(new Date());
    const cfg: any = await this.settings.get().catch(() => null);
    return {
      raio: RAIO_CHECKIN,
      checkinObrigatorio: cfg?.checkinObrigatorio !== false,
      regraAtiva: cfg?.checkinObrigatorio !== false && stands.length > 0 && stands.every((s) => s.localizado),
      faltamLocalizar: stands.filter((s) => !s.localizado).length,
      turnoAtivo: turno ? { id: turno.id, horaInicio: turno.horaInicio, horaFim: turno.horaFim, atendentes: turno.atendenteIds.length } : null,
      stands,
      checkinsHoje: cks.map((c) => ({
        nome: nomes.get(c.userId) ?? "—",
        stand: c.standNome,
        distancia: c.distancia,
        hora: c.createdAt,
        doTurnoAtual: !!turno && c.turnoId === turno.id,
      })),
    };
  }

  /** Situação do corretor agora: está na escala? já fez check-in neste turno? */
  async status(user: User) {
    const turno = await this.escala.turnoAtivo(new Date());
    const regraAtiva = await this.exigeCheckin();
    if (!turno) return { regraAtiva, turnoAtivo: false, naEscala: false, checkin: null };
    const naEscala = (turno.atendenteIds || []).includes(user.id);
    const ck = naEscala
      ? await this.checkins.findOne({ where: { userId: user.id, turnoId: turno.id, data: hojeSP() } })
      : null;
    return {
      regraAtiva,
      turnoAtivo: true,
      turno: { horaInicio: turno.horaInicio, horaFim: turno.horaFim },
      naEscala,
      checkin: ck ? { stand: ck.standNome, distancia: ck.distancia, hora: ck.createdAt } : null,
    };
  }

  /** Check-in: GPS do celular precisa estar a até 200 m de um stand cadastrado. */
  async checkin(user: User, lat: number, lng: number, precisao?: number) {
    if (!isFinite(lat) || !isFinite(lng)) throw new BadRequestException("Não consegui ler sua localização.");
    const turno = await this.escala.turnoAtivo(new Date());
    if (!turno) throw new BadRequestException("Não tem plantão rolando agora — o check-in abre no horário do seu turno.");
    if (!(turno.atendenteIds || []).includes(user.id)) {
      throw new BadRequestException("Você não está na escala deste turno.");
    }
    const data = hojeSP();
    const ja = await this.checkins.findOne({ where: { userId: user.id, turnoId: turno.id, data } });
    if (ja) return { ok: true, jaFeito: true, stand: ja.standNome, distancia: ja.distancia };
    const stands = await this.stands();
    if (!stands.length) throw new BadRequestException("Nenhum stand localizado ainda — avise o Diretor.");
    const r = standMaisPerto(lat, lng, stands, precisao);
    if (!r || !r.dentro) {
      const km = r ? (r.distancia >= 1000 ? `${(r.distancia / 1000).toFixed(1)} km` : `${r.distancia} m`) : "?";
      throw new BadRequestException(
        `Você está a ${km} do stand mais perto (${r?.stand.nome ?? "—"}). Chegue no stand (até ${RAIO_CHECKIN} m) pra fazer o check-in.`
      );
    }
    await this.checkins.save(
      this.checkins.create({
        userId: user.id,
        turnoId: turno.id,
        data,
        propertyId: r.stand.propertyId,
        standNome: r.stand.nome,
        lat,
        lng,
        distancia: r.distancia,
      })
    );
    this.logger.log(`Check-in: ${user.name} no stand ${r.stand.nome} (${r.distancia} m).`);
    return { ok: true, stand: r.stand.nome, distancia: r.distancia };
  }

  /** Dos atendentes do turno, quem fez check-in nele hoje (a fila só usa esses). */
  async comCheckin(turnoId: string, ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    const cks = await this.checkins.find({ where: { turnoId, data: hojeSP(), userId: In(ids) } });
    const feitos = new Set(cks.map((c) => c.userId));
    return ids.filter((id) => feitos.has(id));
  }
}

// Evita aviso de import não usado em alguns builds.
export type { UserRole };
