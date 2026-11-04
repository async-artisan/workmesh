import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * 归档项目拒绝写入。
 *
 * 主路径走 `V1AuthorizationService.resolveProjectContext(..., 'write')`；少数老服务用自己的
 * `projectMember` 查询做成员校验、不经过授权服务，需要显式调用本函数补上同一道闸。
 *
 * 例外：项目自身的归档/解除归档操作不能经过这里——否则归档之后再也解不开。
 */
export async function assertProjectWritable(
  prisma: PrismaService,
  projectId: string,
): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { archivedAt: true },
  });
  // 项目不存在交给调用方原有的 404 逻辑；这里只负责「存在但已归档」。
  if (!project?.archivedAt) return;
  throw new WorkmeshError(
    V1_ERROR_CODES.RESOURCE_CONFLICT,
    'PROJECT_ARCHIVED',
    { projectId, archivedAt: project.archivedAt.toISOString() },
    409,
  );
}
