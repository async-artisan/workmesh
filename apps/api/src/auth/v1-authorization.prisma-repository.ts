import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type {
  V1AuthorizationRepository,
  V1GrantRecord,
  V1KnowledgeBaseRecord,
  V1MemberRecord,
  V1ProjectRecord,
  V1RoleAssignmentRecord,
} from './v1-authorization';

@Injectable()
export class V1AuthorizationPrismaRepository implements V1AuthorizationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findProject(projectId: string): Promise<V1ProjectRecord | null> {
    return this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, version: true, archivedAt: true },
    });
  }

  async findMember(projectId: string, userId: string): Promise<V1MemberRecord | null> {
    return this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { projectId: true, userId: true, role: true, version: true, revokedAt: true },
    });
  }

  async findActiveRoleAssignments(projectId: string, userId: string): Promise<V1RoleAssignmentRecord[]> {
    return this.prisma.projectRoleAssignment.findMany({
      where: { projectId, userId },
      select: { id: true, projectId: true, userId: true, roleId: true, version: true, revokedAt: true },
    });
  }

  async findRoleAssignment(projectId: string, userId: string, roleId: string): Promise<V1RoleAssignmentRecord | null> {
    return this.prisma.projectRoleAssignment.findFirst({
      where: { projectId, userId, roleId },
      select: { id: true, projectId: true, userId: true, roleId: true, version: true, revokedAt: true },
    });
  }

  async findKnowledgeBase(knowledgeBaseId: string): Promise<V1KnowledgeBaseRecord | null> {
    return this.prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId },
      select: {
        id: true,
        projectId: true,
        visibility: true,
        version: true,
        authzVersion: true,
        publicationApproverUserId: true,
        publicationApproverRoleId: true,
        archivedAt: true,
      },
    });
  }

  async findGrants(knowledgeBaseId: string): Promise<V1GrantRecord[]> {
    return this.prisma.knowledgeBaseGrant.findMany({
      where: { knowledgeBaseId },
      select: {
        id: true,
        knowledgeBaseId: true,
        subjectKind: true,
        subjectUserId: true,
        subjectRoleId: true,
        permissions: true,
        revokedAt: true,
      },
    });
  }
}
