import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { LeadHistory, LeadHistoryType } from "./lead-history.entity";

@Injectable()
export class LeadHistoryService {
  constructor(
    @InjectRepository(LeadHistory)
    private readonly repo: Repository<LeadHistory>
  ) {}

  log(entry: {
    leadId: string;
    type: LeadHistoryType;
    description: string;
    userId?: string;
    fromStatus?: string;
    toStatus?: string;
  }) {
    const item = this.repo.create(entry);
    return this.repo.save(item);
  }

  findByLead(leadId: string) {
    return this.repo.find({ where: { leadId }, order: { createdAt: "DESC" } });
  }
}
