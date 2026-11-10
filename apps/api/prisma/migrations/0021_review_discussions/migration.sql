CREATE TABLE "workmesh_v1"."ReviewDiscussion" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "reviewRequestId" UUID NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "body" VARCHAR(10000) NOT NULL,
  "resolved" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByStampId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ReviewDiscussion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReviewDiscussion_version_check" CHECK ("version" >= 1),
  CONSTRAINT "ReviewDiscussion_reviewRequestId_projectId_fkey" FOREIGN KEY ("reviewRequestId", "projectId") REFERENCES "workmesh_v1"."ReviewRequest"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ReviewDiscussion_createdByStampId_fkey" FOREIGN KEY ("createdByStampId") REFERENCES "workmesh_v1"."PrincipalStamp"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ReviewDiscussion_id_projectId_key" ON "workmesh_v1"."ReviewDiscussion"("id", "projectId");
CREATE INDEX "ReviewDiscussion_reviewRequestId_createdAt_id_idx" ON "workmesh_v1"."ReviewDiscussion"("reviewRequestId", "createdAt", "id");

CREATE TABLE "workmesh_v1"."ReviewDiscussionEntry" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "discussionId" UUID NOT NULL,
  "kind" VARCHAR(16) NOT NULL,
  "body" VARCHAR(10000) NOT NULL,
  "addressedInReviewId" UUID,
  "createdByStampId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReviewDiscussionEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReviewDiscussionEntry_kind_check" CHECK ("kind" IN ('REPLY', 'RESOLVED', 'REOPENED')),
  CONSTRAINT "ReviewDiscussionEntry_discussionId_projectId_fkey" FOREIGN KEY ("discussionId", "projectId") REFERENCES "workmesh_v1"."ReviewDiscussion"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ReviewDiscussionEntry_addressedInReviewId_projectId_fkey" FOREIGN KEY ("addressedInReviewId", "projectId") REFERENCES "workmesh_v1"."ReviewRequest"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ReviewDiscussionEntry_createdByStampId_fkey" FOREIGN KEY ("createdByStampId") REFERENCES "workmesh_v1"."PrincipalStamp"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ReviewDiscussionEntry_discussionId_createdAt_id_idx" ON "workmesh_v1"."ReviewDiscussionEntry"("discussionId", "createdAt", "id");
