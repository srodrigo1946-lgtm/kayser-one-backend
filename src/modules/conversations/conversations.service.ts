import { Injectable, NotFoundException, ForbiddenException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Conversation } from "./conversation.entity";
import { Message, MessageDirection } from "./message.entity";
import { Lead } from "../leads/lead.entity";
import { User } from "../users/user.entity";
import { UsersService } from "../users/users.service";

@Injectable()
export class ConversationsService {
  constructor(
    @InjectRepository(Conversation)
    private readonly convRepo: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly msgRepo: Repository<Message>,
    @InjectRepository(Lead)
    private readonly leadsRepo: Repository<Lead>,
    private readonly users: UsersService
  ) {}

  /** Lista conversas respeitando a hierarquia (cada gestor vê apenas as da sua equipe). */
  async list(user: User) {
    const qb = this.convRepo
      .createQueryBuilder("c")
      .leftJoinAndSelect("c.lead", "lead")
      // Só os campos do atendente que interessam ao front (sem passwordHash).
      .leftJoin("c.assignedTo", "atendente")
      .addSelect(["atendente.id", "atendente.name", "atendente.role", "atendente.avatar"])
      .orderBy("c.lastMessageAt", "DESC");

    // scope null = Diretor (vê todas as conversas da empresa).
    // Demais: conversas cujo atendente OU o responsável do lead estão na sua equipe.
    const scopeIds = await this.users.getScopeIds(user);
    if (scopeIds !== null) {
      qb.where("(c.assignedToId IN (:...ids) OR lead.responsavelId IN (:...ids))", { ids: scopeIds });
    }
    return qb.getMany();
  }

  /** Atribui (ou remove) o atendente responsável por uma conversa. */
  async assign(conversationId: string, userId: string | null, requester: User) {
    const conv = await this.convRepo.findOne({ where: { id: conversationId } });
    if (!conv) throw new NotFoundException("Conversa não encontrada.");
    if (userId) {
      const scopeIds = await this.users.getScopeIds(requester);
      if (scopeIds !== null && !scopeIds.includes(userId)) {
        throw new ForbiddenException("Você só pode atribuir a conversa a alguém da sua equipe.");
      }
    }
    conv.assignedToId = userId ?? null;
    await this.convRepo.save(conv);
    return this.stripAssigned(
      await this.convRepo.findOne({ where: { id: conversationId }, relations: ["lead", "assignedTo"] })
    );
  }

  /** Define as etiquetas da conversa (substitui a lista inteira). */
  async setEtiquetas(conversationId: string, etiquetas: string[]) {
    const conv = await this.convRepo.findOne({ where: { id: conversationId } });
    if (!conv) throw new NotFoundException("Conversa não encontrada.");
    conv.etiquetas = Array.isArray(etiquetas) ? etiquetas : [];
    await this.convRepo.save(conv);
    return this.stripAssigned(
      await this.convRepo.findOne({ where: { id: conversationId }, relations: ["lead", "assignedTo"] })
    );
  }

  /** Remove o passwordHash do atendente vinculado, se houver. */
  private stripAssigned(conv: Conversation | null) {
    if (conv?.assignedTo) delete (conv.assignedTo as any).passwordHash;
    return conv;
  }

  async getMessages(conversationId: string) {
    const conv = await this.convRepo.findOne({ where: { id: conversationId }, relations: ["lead", "assignedTo"] });
    if (!conv) throw new NotFoundException("Conversa não encontrada.");
    this.stripAssigned(conv);
    const messages = await this.msgRepo.find({
      where: { conversationId },
      order: { createdAt: "ASC" },
    });
    // Marca como lida
    if (conv.unreadCount > 0) {
      conv.unreadCount = 0;
      await this.convRepo.save(conv);
    }
    return { conversation: conv, messages };
  }

  /** Encontra (ou cria) a conversa pelo número remoto, vinculando a um lead quando possível. */
  async findOrCreateByPhone(remoteJid: string): Promise<Conversation> {
    const phone = remoteJid.replace(/\D/g, "");
    let conv = await this.convRepo.findOne({ where: { remoteJid: phone }, relations: ["lead"] });
    if (conv) return conv;

    // Tenta vincular a um lead existente pelo telefone/whatsapp
    const lead = await this.leadsRepo
      .createQueryBuilder("lead")
      .where("regexp_replace(lead.phone, '[^0-9]', '', 'g') LIKE :p", { p: `%${phone.slice(-8)}%` })
      .orWhere("regexp_replace(coalesce(lead.whatsapp,''), '[^0-9]', '', 'g') LIKE :p", { p: `%${phone.slice(-8)}%` })
      .getOne();

    // Nasce atribuída ao responsável do lead (quando há), definindo a visibilidade por equipe.
    conv = this.convRepo.create({ remoteJid: phone, leadId: lead?.id, assignedToId: lead?.responsavelId });
    return this.convRepo.save(conv);
  }

  async addMessage(
    conversationId: string,
    content: string,
    direction: MessageDirection,
    isAI = false
  ): Promise<Message> {
    const msg = this.msgRepo.create({ conversationId, content, direction, isAI });
    const saved = await this.msgRepo.save(msg);

    const conv = await this.convRepo.findOne({ where: { id: conversationId } });
    if (conv) {
      conv.lastMessage = content;
      conv.lastMessageAt = saved.createdAt;
      if (direction === "in") conv.unreadCount += 1;
      await this.convRepo.save(conv);

      // Atualiza o último contato do lead vinculado
      if (conv.leadId) {
        await this.leadsRepo.update(conv.leadId, { lastContactAt: saved.createdAt });
      }
    }
    return saved;
  }

  /** Histórico recente formatado para enviar à IA. */
  async getHistoryForAi(conversationId: string, limit = 20) {
    const messages = await this.msgRepo.find({
      where: { conversationId },
      order: { createdAt: "ASC" },
      take: limit,
    });
    return messages.map((m) => ({
      role: m.direction === "in" ? ("user" as const) : ("assistant" as const),
      content: m.content,
    }));
  }
}
