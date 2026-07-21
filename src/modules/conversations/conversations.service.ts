import { Injectable, NotFoundException, ForbiddenException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Conversation } from "./conversation.entity";
import { Message, MessageDirection } from "./message.entity";
import { Lead, LeadStatus, LeadSource } from "../leads/lead.entity";
import { User } from "../users/user.entity";
import { UsersService } from "../users/users.service";
import { LeadsService } from "../leads/leads.service";
import { AppointmentsService } from "../appointments/appointments.service";
import { AppointmentType } from "../appointments/appointment.entity";
import { StorageService } from "../storage/storage.service";

// Cada etiqueta do funil move o lead para a coluna correspondente do Kanban.
const ETIQUETA_STATUS: Record<string, LeadStatus> = {
  agendamento: LeadStatus.AGENDAMENTO,
  visita_realizada: LeadStatus.VISITA_REALIZADA,
  subida_pastas: LeadStatus.SUBIDA_PASTA,
  aprovacao: LeadStatus.APROVACAO,
  reprovacao: LeadStatus.REPROVACAO,
  venda_ganha: LeadStatus.VENDA_GANHA,
};

@Injectable()
export class ConversationsService {
  constructor(
    @InjectRepository(Conversation)
    private readonly convRepo: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly msgRepo: Repository<Message>,
    @InjectRepository(Lead)
    private readonly leadsRepo: Repository<Lead>,
    private readonly users: UsersService,
    private readonly leads: LeadsService,
    private readonly appointments: AppointmentsService,
    private readonly storage: StorageService
  ) {}

  /** Lista conversas respeitando a hierarquia (cada gestor vê apenas as da sua equipe). */
  /**
   * Sinal LEVE para o alerta sonoro: só quantas conversas existem no escopo do
   * usuário. Se esse número sobe, é contato novo no WhatsApp (lead orgânico
   * chegando). Evita baixar a lista inteira a cada consulta.
   */
  async contarConversas(user: User) {
    const qb = this.convRepo.createQueryBuilder("c").leftJoin("c.lead", "lead");
    const scopeIds = await this.users.getScopeIds(user);
    if (scopeIds !== null) {
      qb.where("(c.assignedToId IN (:...ids) OR lead.responsavelId IN (:...ids))", { ids: scopeIds });
    }
    return { total: await qb.getCount() };
  }

  async list(user: User) {
    const qb = this.convRepo
      .createQueryBuilder("c")
      .leftJoinAndSelect("c.lead", "lead")
      // Só os campos do atendente que interessam ao front (sem passwordHash).
      .leftJoin("c.assignedTo", "atendente")
      .addSelect(["atendente.id", "atendente.name", "atendente.role", "atendente.avatar"])
      .orderBy("c.lastMessageAt", "DESC");

    // Visibilidade por hierarquia (igual ao resto do sistema): o Diretor vê TODAS
    // as conversas; cada gerente vê as da sua equipe (árvore de descendentes); o
    // corretor vê só as suas. O escopo casa tanto pelo atendente da conversa quanto
    // pelo responsável do lead.
    const scopeIds = await this.users.getScopeIds(user);
    if (scopeIds !== null) {
      qb.where("(c.assignedToId IN (:...ids) OR lead.responsavelId IN (:...ids))", {
        ids: scopeIds,
      });
    }
    return qb.getMany();
  }

  /**
   * Escopo de GESTÃO da conversa (igual ao list): Diretor tudo; demais só a sua
   * equipe. Impede mexer (atribuir/etiquetar) em conversa fora do escopo por id.
   */
  private async assertConvScope(conv: Conversation, user: User) {
    const scopeIds = await this.users.getScopeIds(user);
    if (scopeIds === null) return; // Diretor
    const ownerId = conv.assignedToId ?? undefined;
    const leadRespId = (conv.lead as Lead | undefined)?.responsavelId ?? undefined;
    const ok = (!!ownerId && scopeIds.includes(ownerId)) || (!!leadRespId && scopeIds.includes(leadRespId));
    if (!ok) throw new ForbiddenException("Você não tem acesso a esta conversa.");
  }

  /** Atribui (ou remove) o atendente responsável por uma conversa. */
  async assign(conversationId: string, userId: string | null, requester: User) {
    const conv = await this.convRepo.findOne({ where: { id: conversationId }, relations: ["lead"] });
    if (!conv) throw new NotFoundException("Conversa não encontrada.");
    await this.assertConvScope(conv, requester); // não deixa mexer em conversa fora do escopo
    if (userId) {
      const scopeIds = await this.users.getScopeIds(requester);
      if (scopeIds !== null && !scopeIds.includes(userId)) {
        throw new ForbiddenException("Você só pode atribuir a conversa a alguém da sua equipe.");
      }
    }
    conv.assignedToId = userId ?? null;
    await this.convRepo.save(conv);

    // Sincroniza o responsável do lead vinculado (transferir a conversa move o
    // lead junto). Escreve direto no repo do lead — não chama LeadsService.update,
    // então não há loop.
    if (conv.leadId) {
      await this.leadsRepo.update(conv.leadId, { responsavelId: userId ?? null });
    }

    return this.stripAssigned(
      await this.convRepo.findOne({ where: { id: conversationId }, relations: ["lead", "assignedTo"] })
    );
  }

  /**
   * Define as etiquetas da conversa e integra com Kanban/Agenda:
   * cada etiqueta recém-adicionada move o lead para a coluna correspondente do
   * Kanban; "agendamento" também cria um compromisso na Agenda.
   */
  async setEtiquetas(conversationId: string, etiquetas: string[], requester: User) {
    const conv = await this.convRepo.findOne({ where: { id: conversationId }, relations: ["lead"] });
    if (!conv) throw new NotFoundException("Conversa não encontrada.");
    await this.assertConvScope(conv, requester); // não deixa etiquetar conversa fora do escopo

    const antigas = conv.etiquetas ?? [];
    const novas = Array.isArray(etiquetas) ? etiquetas : [];
    const adicionadas = novas.filter((e) => !antigas.includes(e));

    conv.etiquetas = novas;
    await this.convRepo.save(conv);

    // Toda etiqueta é uma coluna do Kanban → sempre implica movimento.
    // Se ainda não há lead vinculado, cria a partir do número (para o card aparecer/mover).
    const precisaLead = adicionadas.length > 0;
    if (precisaLead && !conv.leadId) {
      const numero = conv.remoteJid ?? "";
      try {
        const lead = await this.leads.create(
          {
            name: conv.contactName || numero || "Contato WhatsApp",
            phone: numero,
            whatsapp: numero,
            // Sem isso a coluna Origem ficava vazia para quem chega direto no
            // WhatsApp — e não dava pra distinguir de lead sem procedência.
            origem: conv.fromAd ? "anuncio" : "whatsapp",
            responsavelId: conv.assignedToId ?? undefined,
          } as any,
          requester,
          // Conversa de anúncio → lead de anúncio; senão, chegou sozinho no WhatsApp.
          conv.fromAd ? LeadSource.ANUNCIO : LeadSource.WHATSAPP
        );
        conv.leadId = lead.id;
        conv.lead = lead;
        await this.convRepo.save(conv);
      } catch {
        /* segue mesmo se não conseguir criar o lead */
      }
    }

    for (const et of adicionadas) {
      // A etiqueta É a coluna do Kanban (key = status). Move o card direto para ela.
      // ETIQUETA_STATUS mantém compatibilidade com chaves antigas.
      const status = ETIQUETA_STATUS[et] ?? et;
      if (status && conv.leadId) {
        try {
          await this.leads.updateStatus(conv.leadId, status, undefined, requester);
        } catch {
          /* não bloqueia a etiqueta se o kanban falhar */
        }
      }
      // Agendamento cria um compromisso na Agenda.
      if (et === "agendamento") {
        const quando = new Date();
        quando.setDate(quando.getDate() + 1);
        quando.setHours(10, 0, 0, 0);
        try {
          await this.appointments.create(
            {
              title: `Agendamento — ${conv.lead?.name ?? conv.remoteJid ?? "Contato"}`,
              type: AppointmentType.VISITA,
              scheduledAt: quando,
              leadId: conv.leadId,
              userId: conv.assignedToId ?? conv.lead?.responsavelId ?? requester.id,
            },
            requester
          );
        } catch {
          /* não bloqueia a etiqueta se a agenda falhar */
        }
      }
    }

    return this.stripAssigned(
      await this.convRepo.findOne({ where: { id: conversationId }, relations: ["lead", "assignedTo"] })
    );
  }

  /** Remove o passwordHash do atendente vinculado, se houver. */
  private stripAssigned(conv: Conversation | null) {
    if (conv?.assignedTo) delete (conv.assignedTo as any).passwordHash;
    return conv;
  }

  async getMessages(conversationId: string, user: User) {
    const conv = await this.convRepo.findOne({ where: { id: conversationId }, relations: ["lead", "assignedTo"] });
    if (!conv) throw new NotFoundException("Conversa não encontrada.");
    await this.assertConvScope(conv, user); // visibilidade por hierarquia (igual ao list)
    this.stripAssigned(conv);
    const rows = await this.msgRepo.find({
      where: { conversationId },
      order: { createdAt: "ASC" },
    });
    // Não envia o mediaKey (pode ser um data URI enorme); expõe só se há mídia.
    const messages = rows.map((m) => {
      const { mediaKey, ...rest } = m;
      return { ...rest, hasMedia: !!mediaKey };
    });
    // Marca como lida
    if (conv.unreadCount > 0) {
      conv.unreadCount = 0;
      await this.convRepo.save(conv);
    }
    return { conversation: conv, messages };
  }

  /**
   * Encontra (ou cria) a conversa pelo número remoto, vinculando a um lead quando possível.
   * `receivingUserId` é o dono da instância que recebeu (cada cargo tem o seu WhatsApp):
   * quando não há responsável de lead, a conversa nasce atribuída a ele.
   */
  async findOrCreateByPhone(remoteJid: string, receivingUserId?: string): Promise<Conversation> {
    const phone = remoteJid.replace(/\D/g, "");
    let conv = await this.convRepo.findOne({ where: { remoteJid: phone }, relations: ["lead"] });
    if (conv) {
      let changed = false;
      // Se ainda não tem dono e sabemos quem recebeu, assume o dono do número.
      if (!conv.assignedToId && receivingUserId) {
        conv.assignedToId = receivingUserId;
        changed = true;
      }
      // Registra qual número/instância recebe esta conversa (para responder pelo certo).
      if (!conv.instanceOwnerId && receivingUserId) {
        conv.instanceOwnerId = receivingUserId;
        changed = true;
      }
      if (changed) await this.convRepo.save(conv);
      return conv;
    }

    // Tenta vincular a um lead existente pelo telefone/whatsapp
    const lead = await this.leadsRepo
      .createQueryBuilder("lead")
      .where("regexp_replace(lead.phone, '[^0-9]', '', 'g') LIKE :p", { p: `%${phone.slice(-8)}%` })
      .orWhere("regexp_replace(coalesce(lead.whatsapp,''), '[^0-9]', '', 'g') LIKE :p", { p: `%${phone.slice(-8)}%` })
      .getOne();

    // Nasce atribuída ao responsável do lead; sem lead, ao dono do número que recebeu.
    // Isso define a visibilidade por equipe (cada cargo vê as conversas do seu WhatsApp).
    conv = this.convRepo.create({
      remoteJid: phone,
      leadId: lead?.id,
      assignedToId: lead?.responsavelId ?? receivingUserId,
      instanceOwnerId: receivingUserId,
    });
    return this.convRepo.save(conv);
  }

  /**
   * Marca a conversa como originada de anúncio e GARANTE um Lead. Se já existe lead,
   * atualiza origem/campanha; se não, CRIA um Lead automaticamente (preenchido com o
   * número/nome do contato) — ele nasce com status "Novo Lead" e cai no Kanban.
   * Devolve o id do lead (novo ou existente).
   */
  async setAdOrigin(
    conversationId: string,
    platform: string,
    campaign?: string,
    leadId?: string
  ): Promise<string | undefined> {
    await this.convRepo.update(conversationId, { fromAd: true });
    if (leadId) {
      // O título do anúncio é a única pista de empreendimento que o Meta manda.
      // NUNCA sobrescrever o que o corretor já preencheu — só completar o vazio.
      const atual = await this.leadsRepo.findOne({ where: { id: leadId } });
      await this.leadsRepo.update(leadId, {
        origem: platform,
        campanha: campaign ?? null,
        source: LeadSource.ANUNCIO,
        ...(campaign && !atual?.empreendimento ? { empreendimento: campaign } : {}),
      });
      return leadId;
    }
    // Sem lead ainda: cria um automaticamente a partir da conversa.
    const conv = await this.convRepo.findOne({ where: { id: conversationId } });
    if (!conv) return undefined;
    const numero = (conv.remoteJid ?? "").replace(/\D/g, "");
    try {
      const lead = this.leadsRepo.create({
        name: conv.contactName || numero || "Contato WhatsApp",
        phone: numero,
        whatsapp: numero,
        origem: platform,
        campanha: campaign ?? undefined,
        empreendimento: campaign ?? undefined, // título do anúncio
        source: LeadSource.ANUNCIO,
        responsavelId: conv.assignedToId ?? undefined,
        // status usa o default da entidade = Novo Lead
      });
      const saved = await this.leadsRepo.save(lead);
      conv.leadId = saved.id;
      await this.convRepo.save(conv);
      return saved.id;
    } catch {
      return undefined; // não quebra o inbound se a criação do lead falhar
    }
  }

  /** Atualiza nome (pushName) e/ou foto de perfil do contato, se mudaram. */
  async setContactInfo(conversationId: string, name?: string | null, avatar?: string | null) {
    const conv = await this.convRepo.findOne({ where: { id: conversationId } });
    if (!conv) return;
    let changed = false;
    if (name && conv.contactName !== name) {
      conv.contactName = name;
      changed = true;
    }
    if (avatar && conv.contactAvatar !== avatar) {
      conv.contactAvatar = avatar;
      changed = true;
    }
    if (changed) await this.convRepo.save(conv);
  }

  async addMessage(
    conversationId: string,
    content: string,
    direction: MessageDirection,
    isAI = false,
    media?: { mediaType?: string; mediaMime?: string; base64?: string }
  ): Promise<Message> {
    // Guarda a mídia (imagem/áudio/etc.): R2 quando configurado, senão data URI no banco.
    let mediaKey: string | undefined;
    if (media?.base64) {
      const mime = media.mediaMime || "application/octet-stream";
      if (this.storage.isEnabled) {
        const ext = (mime.split("/")[1] || "bin").split(";")[0];
        const key = `whatsapp/${conversationId}/${Date.now()}.${ext}`;
        const stored = await this.storage.upload(key, Buffer.from(media.base64, "base64"), mime);
        mediaKey = stored || `data:${mime};base64,${media.base64}`;
      } else {
        mediaKey = `data:${mime};base64,${media.base64}`;
      }
    }
    const msg = this.msgRepo.create({
      conversationId,
      content,
      direction,
      isAI,
      mediaType: media?.mediaType,
      mediaMime: media?.mediaMime,
      mediaKey,
    });
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

  /** Retorna o arquivo de mídia de uma mensagem (para exibir imagem/áudio no chat). */
  async getMessageMedia(messageId: string, user: User) {
    const msg = await this.msgRepo.findOne({ where: { id: messageId } });
    if (!msg || !msg.mediaKey) throw new NotFoundException("Mídia não encontrada.");
    // Escopo por equipe (igual ao list): protege PII do cliente na mídia.
    const conv = await this.convRepo.findOne({ where: { id: msg.conversationId }, relations: ["lead"] });
    if (!conv) throw new NotFoundException("Conversa não encontrada.");
    await this.assertConvScope(conv, user);
    if (msg.mediaKey.startsWith("data:")) {
      const m = msg.mediaKey.match(/^data:(.+?);base64,(.*)$/s);
      return {
        buffer: Buffer.from(m ? m[2] : "", "base64"),
        contentType: msg.mediaMime || (m ? m[1] : "application/octet-stream"),
      };
    }
    const obj = await this.storage.getObject(msg.mediaKey);
    if (!obj) throw new NotFoundException("Mídia indisponível.");
    return { buffer: obj.buffer, contentType: msg.mediaMime || obj.contentType };
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
