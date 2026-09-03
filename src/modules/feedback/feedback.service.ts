import { Injectable, ForbiddenException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { FeedbackNote } from "./feedback-note.entity";
import { User } from "../users/user.entity";
import { UsersService } from "../users/users.service";

@Injectable()
export class FeedbackService {
  constructor(
    @InjectRepository(FeedbackNote)
    private readonly repo: Repository<FeedbackNote>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly users: UsersService
  ) {}

  /** O alvo tem que estar no escopo de quem faz o 1-on-1 (hierarquia). Diretor tudo. */
  private async assertScope(alvoId: string, requester: User) {
    const scope = await this.users.getScopeIds(requester);
    if (scope === null) return; // Diretor
    if (!scope.includes(alvoId)) {
      throw new ForbiddenException("Você só faz 1-on-1 com a sua equipe.");
    }
  }

  async list(alvoTipo: string, alvoId: string, requester: User): Promise<any[]> {
    await this.assertScope(alvoId, requester);
    const notes = await this.repo.find({
      where: { alvoTipo, alvoId },
      order: { createdAt: "DESC" },
    });
    // Junta o nome do autor.
    const autores = await this.usersRepo.find({
      where: { id: In([...new Set(notes.map((n) => n.autorId))]) },
      select: ["id", "name"],
    });
    const nomeById = new Map(autores.map((a) => [a.id, a.name]));
    return notes.map((n) => ({ ...n, autorNome: nomeById.get(n.autorId) ?? "—" }));
  }

  async add(alvoTipo: string, alvoId: string, texto: string, requester: User) {
    await this.assertScope(alvoId, requester);
    const note = this.repo.create({ alvoTipo, alvoId, texto, autorId: requester.id });
    const saved = await this.repo.save(note);
    return { ...saved, autorNome: requester.name };
  }

  async remove(id: string, requester: User): Promise<{ ok: boolean }> {
    const note = await this.repo.findOne({ where: { id } });
    if (!note) return { ok: false };
    await this.assertScope(note.alvoId, requester);
    // Só o autor (ou o Diretor) apaga a própria anotação.
    const scope = await this.users.getScopeIds(requester);
    if (scope !== null && note.autorId !== requester.id) {
      throw new ForbiddenException("Só quem escreveu (ou o Diretor) apaga a anotação.");
    }
    await this.repo.delete(id);
    return { ok: true };
  }
}
