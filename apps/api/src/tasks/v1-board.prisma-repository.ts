import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../node_modules/.prisma/workmesh-v1-client';
import { PrismaService } from '../prisma/prisma.service';
import { workflowStepDisplayNameOf } from '@workmesh/shared';
import {
  V1_BOARD_COLUMNS,
  type V1BoardCard,
  type V1BoardColumn,
  type V1BoardColumnKey,
  type V1BoardColumnPage,
  type V1BoardFilterKind,
  type V1BoardFilterPage,
  type V1BoardReadQuery,
  type V1BoardRepository,
  type V1BoardRequirementPage,
  type V1BoardSnapshot,
  type V1BoardSummary,
} from './v1-board.repository';
import {
  boardQueryKey,
  boardSearchPattern,
  decodeBoardCursor,
  encodeBoardCursor,
} from './v1-board.pagination';

type Tx = Prisma.TransactionClient;
type CountRow = {
  total: bigint;
  matchedTotal: bigint;
  requirementTotal: bigint;
  key: V1BoardColumnKey;
  count: bigint;
};
type TaskPosition = { id: string; generation: number };
type GroupRow = { code: string; title: string; total: bigint; score: bigint } & Record<
  V1BoardColumnKey,
  bigint
>;
const ROLE_PREVIEW_LIMIT = 10;

/** No workflow definitions or all-task arrays leave PostgreSQL. Counts inspect the complete
 * matching relation; only bounded page IDs are subsequently enriched. All generations and
 * retired instances remain visible, matching the original board contract. */
function baseQuery(projectId: string, query: V1BoardReadQuery): Prisma.Sql {
  const searchJoin = query.q
    ? Prisma.sql`
    LEFT JOIN LATERAL (
      SELECT u."email" FROM "workmesh_v1"."TaskClaim" c
      JOIN "workmesh_v1"."User" u ON u."id" = c."userId"
      WHERE c."taskId" = t."id" AND c."projectId" = t."projectId" AND c."releasedAt" IS NULL
      ORDER BY c."claimedAt" DESC, c."id" DESC LIMIT 1
    ) claimant ON true`
    : Prisma.empty;
  const searchText = query.q
    ? Prisma.sql`lower(
    coalesce(r."code", '') || ' ' || coalesce(r."title", '') || ' ' || t."stepKey" || ' ' ||
    coalesce(role."title", '') || ' ' || coalesce(claimant."email", '')
  )`
    : Prisma.sql`''::text`;
  const filters: Prisma.Sql[] = [];
  if (query.q)
    filters.push(Prisma.sql`"searchText" LIKE ${boardSearchPattern(query.q)} ESCAPE '\\'`);
  if (query.roleTitle) filters.push(Prisma.sql`"roleTitle" = ${query.roleTitle}`);
  if (query.requirementCode) filters.push(Prisma.sql`"code" = ${query.requirementCode}`);
  return Prisma.sql`WITH all_tasks AS (
    SELECT t."id", t."generation", r."code", r."title", role."title" AS "roleTitle",
      ${searchText} AS "searchText",
      CASE WHEN t."currentArtifactSetId" IS NOT NULL THEN 'DELIVERED'
        WHEN t."currentClaimId" IS NULL THEN 'BACKLOG'
        WHEN t."workStatus"::text IN ('BLOCKED', 'PAUSED', 'CANCELLED') THEN t."workStatus"::text
        ELSE 'ACTIVE' END AS "columnKey"
    FROM "workmesh_v1"."Task" t
    JOIN "workmesh_v1"."WorkflowInstance" wi ON wi."id" = t."workflowInstanceId" AND wi."projectId" = t."projectId"
    JOIN "workmesh_v1"."Requirement" r ON r."id" = wi."requirementId" AND r."projectId" = t."projectId"
    JOIN "workmesh_v1"."ProjectRole" role ON role."id" = t."roleId" AND role."projectId" = t."projectId"
    ${searchJoin}
    WHERE t."projectId" = ${projectId}::uuid
  ), matched AS (SELECT * FROM all_tasks ${filters.length ? Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}` : Prisma.empty})`;
}

@Injectable()
export class V1BoardPrismaRepository implements V1BoardRepository {
  constructor(private readonly prisma: PrismaService) {}

  private read<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        return work(tx);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async summary(tx: Tx, base: Prisma.Sql): Promise<V1BoardSummary> {
    const rows = await tx.$queryRaw<CountRow[]>(Prisma.sql`${base}
      SELECT (SELECT count(*) FROM all_tasks) AS total,
        (SELECT count(*) FROM matched) AS "matchedTotal",
        (SELECT count(DISTINCT "code") FROM matched) AS "requirementTotal",
        "columnKey" AS key, count(*) AS count FROM matched GROUP BY "columnKey"`);
    // Empty matched sets still need the unfiltered project total.
    const fallback = rows.length
      ? rows[0]
      : (
          await tx.$queryRaw<Array<{ total: bigint }>>(
            Prisma.sql`${base} SELECT count(*) AS total FROM all_tasks`,
          )
        )[0];
    return {
      total: Number(fallback?.total ?? 0),
      matchedTotal: Number(rows[0]?.matchedTotal ?? 0),
      requirementTotal: Number(rows[0]?.requirementTotal ?? 0),
      columns: V1_BOARD_COLUMNS.map((key) => ({
        key,
        total: Number(rows.find((row) => row.key === key)?.count ?? 0),
      })),
    };
  }

  async snapshot(projectId: string, query: V1BoardReadQuery): Promise<V1BoardSnapshot> {
    return this.read(async (tx) => {
      const base = baseQuery(projectId, query);
      const summary = await this.summary(tx, base);
      const rows = await tx.$queryRaw<
        Array<TaskPosition & { columnKey: V1BoardColumnKey }>
      >(Prisma.sql`${base}, ranked AS (
        SELECT id, generation, "columnKey", row_number() OVER (PARTITION BY "columnKey" ORDER BY generation DESC, id ASC) AS position FROM matched
      ) SELECT id, generation, "columnKey" FROM ranked WHERE position <= ${query.limit + 1}
        ORDER BY generation DESC, id ASC`);
      const positions = V1_BOARD_COLUMNS.map((key) => rows.filter((row) => row.columnKey === key));
      const cards = await this.cardsByIds(
        tx,
        projectId,
        positions.flatMap((page) => page.slice(0, query.limit).map((row) => row.id)),
      );
      const byId = new Map(cards.map((card) => [card.taskId, card]));
      const columns = V1_BOARD_COLUMNS.map((key, index) => {
        const page = positions[index].slice(0, query.limit);
        const last = page[page.length - 1];
        return {
          key,
          total: summary.columns[index].total,
          cards: page.map((row) => byId.get(row.id)!),
          nextCursor:
            positions[index].length > query.limit
              ? encodeBoardCursor(projectId, query, `column:${key}`, {
                  generation: last.generation,
                  id: last.id,
                })
              : null,
        };
      });
      return { projectId, queryKey: boardQueryKey(projectId, query), summary, columns };
    });
  }

  async column(
    projectId: string,
    key: V1BoardColumnKey,
    query: V1BoardReadQuery,
  ): Promise<V1BoardColumnPage> {
    return this.read(async (tx) => {
      const base = baseQuery(projectId, query);
      const [count] = await tx.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`${base}
        SELECT count(*) AS total FROM matched WHERE "columnKey" = ${key}`);
      const page = await this.cardPage(tx, projectId, key, query, base, Number(count.total));
      return { projectId, queryKey: boardQueryKey(projectId, query), ...page };
    });
  }

  private async cardPage(
    tx: Tx,
    projectId: string,
    key: V1BoardColumnKey,
    query: V1BoardReadQuery,
    base: Prisma.Sql,
    total: number,
  ): Promise<V1BoardColumn> {
    const view = `column:${key}`;
    const after = decodeBoardCursor(projectId, query, view) as TaskPosition | null;
    const cursorWhere = after
      ? Prisma.sql`AND ("generation" < ${after.generation} OR ("generation" = ${after.generation} AND "id" > ${after.id}::uuid))`
      : Prisma.empty;
    const rows = await tx.$queryRaw<TaskPosition[]>(Prisma.sql`${base}
      SELECT "id", "generation" FROM matched WHERE "columnKey" = ${key} ${cursorWhere}
      ORDER BY "generation" DESC, "id" ASC LIMIT ${query.limit + 1}`);
    const page = rows.slice(0, query.limit);
    return {
      key,
      total,
      cards: await this.cardsByIds(
        tx,
        projectId,
        page.map((row) => row.id),
      ),
      nextCursor:
        rows.length > query.limit
          ? encodeBoardCursor(projectId, query, view, page[page.length - 1])
          : null,
    };
  }

  async requirements(projectId: string, query: V1BoardReadQuery): Promise<V1BoardRequirementPage> {
    return this.read(async (tx) => {
      const base = baseQuery(projectId, query);
      const summary = await this.summary(tx, base);
      const after = decodeBoardCursor(projectId, query, 'requirements') as {
        score: number;
        code: string;
      } | null;
      const cursorWhere = after
        ? Prisma.sql`WHERE (score < ${after.score} OR (score = ${after.score} AND code COLLATE "C" > ${after.code} COLLATE "C"))`
        : Prisma.empty;
      const counts = V1_BOARD_COLUMNS.map(
        (key) =>
          Prisma.sql`count(*) FILTER (WHERE "columnKey" = ${key}) AS ${Prisma.raw(`"${key}"`)}`,
      );
      const rows = await tx.$queryRaw<GroupRow[]>(Prisma.sql`${base}, groups AS (
        SELECT code, min(title) AS title, count(*) AS total, ${Prisma.join(counts)},
          count(*) FILTER (WHERE "columnKey" = 'BLOCKED') * 10 + count(*) FILTER (WHERE "columnKey" = 'ACTIVE') AS score
        FROM matched GROUP BY code
      ) SELECT * FROM groups ${cursorWhere} ORDER BY score DESC, code COLLATE "C" ASC LIMIT ${query.limit + 1}`);
      const page = rows.slice(0, query.limit);
      const roleRows = page.length
        ? await tx.$queryRaw<
            Array<{ code: string; value: string; total: bigint }>
          >(Prisma.sql`${base}, role_values AS (
        SELECT code, "roleTitle" AS value FROM matched WHERE code IN (${Prisma.join(page.map((row) => row.code))}) AND "roleTitle" <> ''
        GROUP BY code, "roleTitle"
      ), ranked_roles AS (SELECT code, value, count(*) OVER (PARTITION BY code) AS total,
        row_number() OVER (PARTITION BY code ORDER BY value COLLATE "C" ASC) AS position FROM role_values)
      SELECT code, value, total FROM ranked_roles WHERE position <= ${ROLE_PREVIEW_LIMIT + 1} ORDER BY code COLLATE "C", value COLLATE "C"`)
        : [];
      const items = page.map((row) => {
        const roleQuery = {
          ...query,
          requirementCode: row.code,
          search: '',
          cursor: null,
          limit: ROLE_PREVIEW_LIMIT,
        };
        const roles = roleRows.filter((role) => role.code === row.code);
        const rolePage = roles.slice(0, ROLE_PREVIEW_LIMIT);
        return {
          code: row.code,
          title: row.title,
          total: Number(row.total),
          counts: Object.fromEntries(
            V1_BOARD_COLUMNS.map((key) => [key, Number(row[key])]),
          ) as Record<V1BoardColumnKey, number>,
          roles: rolePage.map((role) => role.value),
          roleTotal: Number(roles[0]?.total ?? 0),
          rolesNextCursor:
            roles.length > ROLE_PREVIEW_LIMIT
              ? encodeBoardCursor(projectId, roleQuery, 'filters:roles', {
                  value: rolePage[rolePage.length - 1].value,
                })
              : null,
        };
      });
      const last = page[page.length - 1];
      return {
        projectId,
        queryKey: boardQueryKey(projectId, query),
        summary,
        items,
        nextCursor:
          rows.length > query.limit
            ? encodeBoardCursor(projectId, query, 'requirements', {
                score: Number(last.score),
                code: last.code,
              })
            : null,
      };
    });
  }

  async filters(
    projectId: string,
    kind: V1BoardFilterKind,
    query: V1BoardReadQuery,
  ): Promise<V1BoardFilterPage> {
    return this.read((tx) => this.filterPage(tx, projectId, kind, query));
  }

  private async filterPage(
    tx: Tx,
    projectId: string,
    kind: V1BoardFilterKind,
    query: V1BoardReadQuery,
  ): Promise<V1BoardFilterPage> {
    const view = `filters:${kind}`;
    const after = decodeBoardCursor(projectId, query, view) as { value: string } | null;
    const field = kind === 'roles' ? Prisma.sql`"roleTitle"` : Prisma.sql`code`;
    const label = kind === 'roles' ? Prisma.sql`"roleTitle"` : Prisma.sql`code || ' · ' || title`;
    const searchWhere = query.search
      ? Prisma.sql`AND lower(${label}) LIKE ${boardSearchPattern(query.search)} ESCAPE '\\'`
      : Prisma.empty;
    const base = Prisma.sql`${baseQuery(projectId, query)}, options AS (SELECT ${field} AS value, min(${label}) AS label FROM matched WHERE ${field} <> '' ${searchWhere} GROUP BY ${field})`;
    const [count] = await tx.$queryRaw<Array<{ total: bigint }>>(
      Prisma.sql`${base} SELECT count(*) AS total FROM options`,
    );
    const rows = await tx.$queryRaw<Array<{ value: string; label: string }>>(Prisma.sql`${base}
      SELECT value, label FROM options ${after ? Prisma.sql`WHERE value COLLATE "C" > ${after.value} COLLATE "C"` : Prisma.empty}
      ORDER BY value COLLATE "C" ASC LIMIT ${query.limit + 1}`);
    const items = rows.slice(0, query.limit);
    return {
      projectId,
      queryKey: boardQueryKey(projectId, query, view),
      total: Number(count.total),
      items,
      nextCursor:
        rows.length > query.limit
          ? encodeBoardCursor(projectId, query, view, { value: items[items.length - 1].value })
          : null,
    };
  }

  private async cardsByIds(tx: Tx, projectId: string, ids: string[]): Promise<V1BoardCard[]> {
    if (ids.length === 0) return [];
    const tasks = await tx.task.findMany({
      where: { projectId, id: { in: ids } },
      orderBy: [{ generation: 'desc' }, { id: 'asc' }],
      take: ids.length,
      select: {
        id: true,
        projectId: true,
        stepKey: true,
        roleId: true,
        generation: true,
        executionStatus: true,
        workStatus: true,
        currentClaimId: true,
        currentArtifactSetId: true,
        role: { select: { key: true, title: true } },
        instance: {
          select: {
            definitionRevisionId: true,
            requirement: { select: { id: true, code: true, title: true } },
          },
        },
        responsibleUser: { select: { email: true } },
      },
    });
    // Per-task LIMIT 1 prevents a broken duplicate active claim from expanding the page.
    const claims = await tx.$queryRaw<
      Array<{ taskId: string; userId: string; claimedAt: Date; email: string }>
    >(Prisma.sql`
      SELECT t."id" AS "taskId", current_claim."userId", current_claim."claimedAt", current_claim."email"
      FROM "workmesh_v1"."Task" t
      JOIN LATERAL (SELECT c."userId", c."claimedAt", u."email" FROM "workmesh_v1"."TaskClaim" c
        JOIN "workmesh_v1"."User" u ON u."id" = c."userId"
        WHERE c."taskId" = t."id" AND c."projectId" = ${projectId}::uuid AND c."releasedAt" IS NULL
        ORDER BY c."claimedAt" DESC, c."id" DESC LIMIT 1) current_claim ON true
      WHERE t."projectId" = ${projectId}::uuid AND t."id" IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})`);
    const claimByTask = new Map(claims.map((claim) => [claim.taskId, claim]));
    const revisionIds = [
      ...new Set(
        tasks.flatMap((task) =>
          task.instance.definitionRevisionId ? [task.instance.definitionRevisionId] : [],
        ),
      ),
    ];
    const revisions = revisionIds.length
      ? await tx.workflowRevision.findMany({
          where: { id: { in: revisionIds }, projectId },
          select: { id: true, definition: true },
          take: ids.length,
        })
      : [];
    const definitionByRevision = new Map(
      revisions.map((revision) => [revision.id, revision.definition]),
    );
    return tasks.map((task) => {
      const claim = claimByTask.get(task.id);
      return {
        taskId: task.id,
        projectId: task.projectId,
        stepKey: task.stepKey,
        stepDisplayName: task.instance.definitionRevisionId
          ? workflowStepDisplayNameOf(
              definitionByRevision.get(task.instance.definitionRevisionId),
              task.stepKey,
            )
          : null,
        roleId: task.roleId,
        requirementId: task.instance.requirement.id,
        requirementCode: task.instance.requirement.code,
        requirementTitle: task.instance.requirement.title,
        roleKey: task.role.key,
        roleTitle: task.role.title,
        responsibleUserEmail: task.responsibleUser.email,
        claimedUserEmail: claim?.email,
        executionStatus: task.executionStatus,
        workStatus: task.workStatus,
        currentClaimId: task.currentClaimId,
        currentArtifactSetId: task.currentArtifactSetId,
        claimedUserId: claim?.userId ?? null,
        claimedAt: claim?.claimedAt ? claim.claimedAt.toISOString() : null,
        generation: task.generation,
      };
    });
  }
}
