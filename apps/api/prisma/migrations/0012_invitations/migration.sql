-- 邀请链接：管理员生成、带角色、限时、一次性接受；只存 token 的 sha256。
CREATE TABLE "workmesh_v1"."ProjectInvitation" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "email" VARCHAR(254),
    "roleIds" UUID[],
    "invitedById" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3),
    "acceptedByUserId" UUID,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectInvitation_tokenHash_key" ON "workmesh_v1"."ProjectInvitation"("tokenHash");
CREATE INDEX "ProjectInvitation_projectId_createdAt_idx" ON "workmesh_v1"."ProjectInvitation"("projectId", "createdAt");
CREATE INDEX "ProjectInvitation_expiresAt_idx" ON "workmesh_v1"."ProjectInvitation"("expiresAt");

ALTER TABLE "workmesh_v1"."ProjectInvitation" ADD CONSTRAINT "ProjectInvitation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "workmesh_v1"."Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workmesh_v1"."ProjectInvitation" ADD CONSTRAINT "ProjectInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "workmesh_v1"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workmesh_v1"."ProjectInvitation" ADD CONSTRAINT "ProjectInvitation_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "workmesh_v1"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
