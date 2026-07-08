import { Injectable, ForbiddenException, ExecutionContext } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

// Rotas liberadas mesmo com a senha ainda não trocada (primeiro acesso).
const ALLOWED_WHEN_FIRST_LOGIN = ["/auth/change-password", "/auth/me", "/auth/refresh"];

@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {
  handleRequest(err: any, user: any, info: any, context: ExecutionContext) {
    // Erro/sem usuário: mantém o comportamento padrão (401).
    if (err || !user) {
      return super.handleRequest(err, user, info, context);
    }
    // Primeiro acesso: obriga a trocar a senha antes de usar o restante da API.
    if (user.firstLogin) {
      const req = context.switchToHttp().getRequest();
      const url: string = req.originalUrl || req.url || "";
      const allowed = ALLOWED_WHEN_FIRST_LOGIN.some((p) => url.includes(p));
      if (!allowed) {
        throw new ForbiddenException("Troque sua senha no primeiro acesso para continuar.");
      }
    }
    return user;
  }
}
