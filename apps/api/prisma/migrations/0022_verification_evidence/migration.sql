CREATE UNIQUE INDEX "ProjectRepository_id_projectId_key" ON "workmesh_v1"."ProjectRepository"("id", "projectId");
CREATE TABLE "workmesh_v1"."VerificationObservation" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "projectRepositoryId" UUID NOT NULL,
  "providerRepositoryId" VARCHAR(120) NOT NULL,
  "runId" VARCHAR(120) NOT NULL,
  "attempt" INTEGER NOT NULL,
  "payloadDigest" CHAR(64) NOT NULL,
  "payload" JSONB NOT NULL,
  "collectedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByStampId" UUID NOT NULL,
  CONSTRAINT "VerificationObservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VerificationObservation_attempt_check" CHECK ("attempt" >= 1),
  CONSTRAINT "VerificationObservation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "workmesh_v1"."Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VerificationObservation_repository_fkey" FOREIGN KEY ("projectRepositoryId", "projectId") REFERENCES "workmesh_v1"."ProjectRepository"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VerificationObservation_stamp_fkey" FOREIGN KEY ("createdByStampId") REFERENCES "workmesh_v1"."PrincipalStamp"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "VerificationObservation_identity_digest_key" ON "workmesh_v1"."VerificationObservation"("projectId", "projectRepositoryId", "runId", "attempt", "payloadDigest");
CREATE UNIQUE INDEX "VerificationObservation_id_projectId_key" ON "workmesh_v1"."VerificationObservation"("id", "projectId");
CREATE INDEX "VerificationObservation_run_idx" ON "workmesh_v1"."VerificationObservation"("projectId", "projectRepositoryId", "runId", "attempt");

CREATE TABLE "workmesh_v1"."VerificationBinding" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "observationId" UUID NOT NULL,
  "artifactSetId" UUID NOT NULL,
  "taskGeneration" INTEGER NOT NULL,
  "snapshotId" UUID NOT NULL,
  "manifestDigest" CHAR(64) NOT NULL,
  "diagnostics" JSONB NOT NULL,
  "createdByStampId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VerificationBinding_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VerificationBinding_generation_check" CHECK ("taskGeneration" >= 1),
  CONSTRAINT "VerificationBinding_observation_fkey" FOREIGN KEY ("observationId", "projectId") REFERENCES "workmesh_v1"."VerificationObservation"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VerificationBinding_artifactSet_fkey" FOREIGN KEY ("artifactSetId", "projectId") REFERENCES "workmesh_v1"."ArtifactSet"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VerificationBinding_snapshot_fkey" FOREIGN KEY ("snapshotId", "projectId") REFERENCES "workmesh_v1"."ContextSnapshot"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VerificationBinding_stamp_fkey" FOREIGN KEY ("createdByStampId") REFERENCES "workmesh_v1"."PrincipalStamp"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "VerificationBinding_projectId_observationId_artifactSetId_key" ON "workmesh_v1"."VerificationBinding"("projectId", "observationId", "artifactSetId");
CREATE INDEX "VerificationBinding_artifactSetId_createdAt_idx" ON "workmesh_v1"."VerificationBinding"("artifactSetId", "createdAt");
