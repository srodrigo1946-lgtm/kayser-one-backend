import { CanActivate, Injectable, NotFoundException } from "@nestjs/common";

/**
 * Instalação da Kayser (matriz), a única que vende o sistema. Servidor de cliente sempre
 * tem LIMITE_USUARIOS (posto pelo provisionar), então nunca é matriz — nem se alguém
 * colocar o RAILWAY_API_TOKEN nele por engano.
 */
export const ehMatriz = () => !!process.env.RAILWAY_API_TOKEN && !process.env.LIMITE_USUARIOS;

/** Rotas só da matriz: no servidor de cliente respondem 404, como se não existissem. */
@Injectable()
export class SoMatrizGuard implements CanActivate {
  canActivate(): boolean {
    if (!ehMatriz()) throw new NotFoundException();
    return true;
  }
}
