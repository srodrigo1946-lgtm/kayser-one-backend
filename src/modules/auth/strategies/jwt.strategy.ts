import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { User } from "../../users/user.entity";
import { resolveJwtSecret, versaoSenha } from "../jwt-secret";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>
  ) {
    super({
      // Só no cabeçalho Authorization. O `?token=` na URL saiu (10/10): ficava gravado
      // nos logs do servidor; a mídia agora é baixada pelo front com o cabeçalho.
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: resolveJwtSecret(config),
    });
  }

  async validate(payload: { sub: string; pv?: string }) {
    const user = await this.usersRepo
      .createQueryBuilder("u")
      .addSelect("u.passwordHash")
      .where("u.id = :id AND u.active = true", { id: payload.sub })
      .getOne();
    if (!user) throw new UnauthorizedException();
    // Senha trocada depois do login → token antigo não vale mais. Token sem `pv`
    // (emitido antes desta regra) ainda vale até expirar (no máximo 7 dias).
    if (payload.pv && payload.pv !== versaoSenha(user.passwordHash)) {
      throw new UnauthorizedException("Sua senha foi alterada. Entre de novo.");
    }
    delete (user as any).passwordHash;
    return user;
  }
}
