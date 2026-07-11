import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";

/** Permite apenas o Diretor. Usar depois do JwtAuthGuard (req.user já carregado). */
@Injectable()
export class DiretorGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    if (req.user?.role !== "diretor") {
      throw new ForbiddenException("Apenas o Diretor pode alterar a fila.");
    }
    return true;
  }
}
