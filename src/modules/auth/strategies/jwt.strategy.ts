import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { User } from "../../users/user.entity";
import { resolveJwtSecret } from "../jwt-secret";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>
  ) {
    super({
      // Aceita o token no header Authorization OU na query `?token=` — este último
      // é necessário para carregar mídia protegida dentro de <img>/<audio>.
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req) => (typeof req?.query?.token === "string" ? req.query.token : null),
      ]),
      secretOrKey: resolveJwtSecret(config),
    });
  }

  async validate(payload: { sub: string }) {
    const user = await this.usersRepo.findOne({ where: { id: payload.sub, active: true } });
    if (!user) throw new UnauthorizedException();
    return user;
  }
}
