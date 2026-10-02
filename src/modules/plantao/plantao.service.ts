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
    return (await this.props.count({ where: { active: true, standLat: Not(IsNull()) } as any })) > 0;
  }

  /** Busca a coordenada de um endereço (OpenStreetMap/Nominatim). */
  private async geocodificar(endereco: string): Promise<{ lat: number; lng: number } | null> {
    const limpo = endereco.replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
    const tentativas = [limpo, limpo.replace(/,?\s*-?\s*[A-Z]{2}\s*$/, "")];
    for (const q of tentativas) {
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(q)}`;
        const r = await fetch(url, { headers: { "User-Agent": "KayserOneCRM/1.0 (stands de plantao)", "Accept-Language": "pt-BR" } });
        if (r.ok) {
          const j: any[] = await r.json();
          if (j?.[0]?.lat) return { lat: Number(j[0].lat), lng: Number(j[0].lon) };
        }
      } catch {
        /* tenta a próxima */
      }
      await new Promise((res) => setTimeout(res, 1100)); // Nominatim: 1 consulta/s
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
    for (const p of pendentes) {
      const end = p.standAddress.trim();
      if (!cache.has(end)) {
        cache.set(end, await this.geocodificar(end));
        await new Promise((res) => setTimeout(res, 1100));
      }
      const c = cache.get(end);
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
    const iguais = p.standAddress
      ? (await this.props.find({ where: { standAddress: p.standAddress } })).map((x) => x.id)
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
      regraAtiva: cfg?.checkinObrigatorio !== false && stands.some((s) => s.localizado),
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
