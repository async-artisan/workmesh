-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "workmesh_v1";

-- CreateEnum
CREATE TYPE "workmesh_v1"."MemberRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "workmesh_v1"."Visibility" AS ENUM ('PROJECT', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "workmesh_v1"."GrantSubjectKind" AS ENUM ('USER', 'ROLE');

-- CreateEnum
CREATE TYPE "workmesh_v1"."DocumentKind" AS ENUM ('UNDERSTANDING', 'DECISION', 'PRD', 'KNOWLEDGE');

-- CreateEnum
CREATE TYPE "workmesh_v1"."PublicationKind" AS ENUM ('PUBLISH', 'WITHDRAW');

-- CreateEnum
CREATE TYPE "workmesh_v1"."WorkflowStepKind" AS ENUM ('PRODUCT', 'DELIVERY', 'VERIFY', 'RELEASE');

-- CreateEnum
CREATE TYPE "workmesh_v1"."BaselinePolicy" AS ENUM ('NONE', 'PUBLISHED_PRD');

-- CreateEnum
CREATE TYPE "workmesh_v1"."TaskExecutionStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'REVIEW_PENDING', 'DONE');

-- CreateEnum
CREATE TYPE "workmesh_v1"."WorkStatus" AS ENUM ('ACTIVE', 'BLOCKED', 'PAUSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "workmesh_v1"."ArtifactKind" AS ENUM ('PRD', 'DESIGN', 'IMPL', 'CASES', 'RELEASE');

-- CreateEnum
CREATE TYPE "workmesh_v1"."ArtifactStorage" AS ENUM ('HOSTED', 'GIT_REF');

-- CreateEnum
CREATE TYPE "workmesh_v1"."ReviewKind" AS ENUM ('UNDERSTANDING_CONFIRM', 'PRD_PUBLICATION', 'KNOWLEDGE_PUBLICATION', 'TASK_ACCEPTANCE', 'RELEASE_ACCEPTANCE');

-- CreateEnum
CREATE TYPE "workmesh_v1"."ReviewStatus" AS ENUM ('OPEN', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "workmesh_v1"."DecisionKind" AS ENUM ('APPROVE', 'CHANGES_REQUESTED', 'REJECT');

-- CreateEnum
CREATE TYPE "workmesh_v1"."ReviewerKind" AS ENUM ('USER', 'BOT');

-- CreateEnum
CREATE TYPE "workmesh_v1"."ReviewEvidenceState" AS ENUM ('APPROVED', 'CHANGES_REQUESTED', 'DISMISSED', 'COMMENTED', 'PENDING');

-- CreateEnum
CREATE TYPE "workmesh_v1"."WebhookSource" AS ENUM ('GITHUB');

-- CreateEnum
CREATE TYPE "workmesh_v1"."SnapshotRefKind" AS ENUM ('DOCUMENT_REVISION', 'ARTIFACT', 'ROLE_RESOURCE');

-- CreateEnum
CREATE TYPE "workmesh_v1"."SnapshotAuthority" AS ENUM ('PUBLISHED', 'CANDIDATE');

-- CreateTable
CREATE TABLE "workmesh_v1"."User" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "authVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."Project" (
    "id" UUID NOT NULL,
    "key" VARCHAR(6) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "knowledgeBindingsVersion" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMPTZ(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."ProjectMember" (
    "projectId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "workmesh_v1"."MemberRole" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "grantedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("projectId","userId")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."ProjectRole" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "key" VARCHAR(48) NOT NULL,
    "title" VARCHAR(80) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."ProjectRoleAssignment" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "grantedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ProjectRoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."KnowledgeBase" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "key" VARCHAR(48) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "visibility" "workmesh_v1"."Visibility" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "authzVersion" INTEGER NOT NULL DEFAULT 1,
    "publicationApproverUserId" UUID NOT NULL,
    "publicationApproverRoleId" UUID,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "KnowledgeBase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."KnowledgeBaseGrant" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "knowledgeBaseId" UUID NOT NULL,
    "subjectKind" "workmesh_v1"."GrantSubjectKind" NOT NULL,
    "subjectUserId" UUID,
    "subjectRoleId" UUID,
    "permissions" TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "grantedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "KnowledgeBaseGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."KnowledgeDocument" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "knowledgeBaseId" UUID NOT NULL,
    "requirementId" UUID,
    "kind" "workmesh_v1"."DocumentKind" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "nextRevisionSeq" INTEGER NOT NULL DEFAULT 1,
    "currentPublishedRevisionId" UUID,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "KnowledgeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."DocumentRevision" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "bodyBytes" BYTEA NOT NULL,
    "byteLength" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "sourceRef" JSONB,
    "basisUnderstandingRevisionId" UUID,
    "deliveryScope" JSONB,
    "acceptance" JSONB,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."DocumentPublication" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "kind" "workmesh_v1"."PublicationKind" NOT NULL,
    "reviewRequestId" UUID,
    "previousPublicationId" UUID,
    "reason" VARCHAR(1000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentPublication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."Requirement" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(10000),
    "version" INTEGER NOT NULL DEFAULT 1,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "phase" VARCHAR(32) NOT NULL DEFAULT 'DISCOVERY',
    "workStatus" "workmesh_v1"."WorkStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentUnderstandingRevisionId" UUID,
    "currentPrdRevisionId" UUID,
    "deliveryScope" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Requirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."WebSession" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "tokenHash" CHAR(64) NOT NULL,
    "csrfTokenHash" CHAR(64) NOT NULL,
    "userAuthVersion" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idleExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "WebSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."AgentCredential" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "scopes" TEXT[],
    "userAuthVersion" INTEGER NOT NULL,
    "authorizedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "authorizedByStampId" UUID,

    CONSTRAINT "AgentCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."WorkflowDefinition" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "workflowKey" VARCHAR(48) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "currentRevisionId" UUID,

    CONSTRAINT "WorkflowDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."WorkflowRevision" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "definitionId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "digest" CHAR(64) NOT NULL,
    "definition" JSONB NOT NULL,
    "compiledRules" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."WorkflowInstance" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "definitionId" UUID NOT NULL,
    "definitionRevisionId" UUID,
    "definitionDigest" CHAR(64),
    "requirementId" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "workStatus" "workmesh_v1"."WorkStatus" NOT NULL DEFAULT 'ACTIVE',
    "bindings" JSONB,
    "retiredAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."Task" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "workflowInstanceId" UUID NOT NULL,
    "stepKey" VARCHAR(48) NOT NULL,
    "roleId" UUID NOT NULL,
    "responsibleUserId" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "executionStatus" "workmesh_v1"."TaskExecutionStatus" NOT NULL DEFAULT 'OPEN',
    "workStatus" "workmesh_v1"."WorkStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentClaimId" UUID,
    "currentSnapshotId" UUID,
    "currentArtifactSetId" UUID,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."TaskClaim" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "taskGeneration" INTEGER NOT NULL,
    "userId" UUID NOT NULL,
    "credentialId" UUID,
    "claimedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMPTZ(3),
    "releaseReason" VARCHAR(1000),

    CONSTRAINT "TaskClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."ContextSnapshot" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "requirementId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "requirementGeneration" INTEGER NOT NULL,
    "taskGeneration" INTEGER NOT NULL,
    "workflowDefinitionRevisionId" UUID NOT NULL,
    "claimId" UUID NOT NULL,
    "manifest" JSONB NOT NULL,
    "manifestDigest" CHAR(64) NOT NULL,
    "createdByStampId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContextSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."ProjectKnowledgeBinding" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "roleId" UUID,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "createdByStampId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectKnowledgeBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."ArtifactSet" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "taskGeneration" INTEGER NOT NULL,
    "snapshotId" UUID NOT NULL,
    "manifestDigest" CHAR(64) NOT NULL,
    "workflowDefinitionRevisionId" UUID NOT NULL,
    "localRunId" VARCHAR(120) NOT NULL,
    "createdByStampId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtifactSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."ArtifactSetItem" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "artifactSetId" UUID NOT NULL,
    "artifactId" UUID,
    "candidateRevisionId" UUID,

    CONSTRAINT "ArtifactSetItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."Artifact" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "artifactSetId" UUID NOT NULL,
    "kind" "workmesh_v1"."ArtifactKind" NOT NULL,
    "schemaVersion" VARCHAR(16) NOT NULL,
    "storage" "workmesh_v1"."ArtifactStorage" NOT NULL,
    "mediaType" VARCHAR(100) NOT NULL,
    "byteLength" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "bodyBytes" BYTEA,
    "projectRepositoryId" UUID,
    "commitSha" VARCHAR(128),
    "repoPath" VARCHAR(500),
    "summary" VARCHAR(2000),
    "checks" JSONB NOT NULL,
    "submittedByStampId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Artifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."ReviewRequest" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "kind" "workmesh_v1"."ReviewKind" NOT NULL,
    "documentRevisionId" UUID,
    "artifactSetId" UUID,
    "taskId" UUID,
    "taskGeneration" INTEGER,
    "subjectDigest" CHAR(64) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "workmesh_v1"."ReviewStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."ApprovalSlot" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "reviewRequestId" UUID NOT NULL,
    "slotKey" VARCHAR(48) NOT NULL,
    "kind" VARCHAR(48) NOT NULL,
    "requiredUserId" UUID,
    "requiredRoleId" UUID,
    "sourceSlotBindingId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."ReviewDecision" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "reviewRequestId" UUID NOT NULL,
    "approvalSlotId" UUID NOT NULL,
    "decision" "workmesh_v1"."DecisionKind" NOT NULL,
    "subjectDigest" CHAR(64) NOT NULL,
    "comment" VARCHAR(2000),
    "confirmationTicketId" UUID,
    "createdByStampId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."ReviewDecisionRevocation" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "decisionId" UUID NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "confirmationTicketId" UUID,
    "createdByStampId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewDecisionRevocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."ChangeEvent" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "requirementId" UUID,
    "sourceKind" VARCHAR(40) NOT NULL,
    "sourceId" UUID NOT NULL,
    "changedFields" TEXT[],
    "targets" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."ChangeRecipient" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "ackedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."ConfirmationTicket" (
    "id" UUID NOT NULL,
    "secretHash" CHAR(64) NOT NULL,
    "userId" UUID NOT NULL,
    "webSessionId" UUID NOT NULL,
    "projectId" UUID,
    "userAuthVersion" INTEGER NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "targetType" VARCHAR(40) NOT NULL,
    "targetId" UUID NOT NULL,
    "expectedVersion" INTEGER NOT NULL,
    "actionDigest" CHAR(64) NOT NULL,
    "roleId" UUID,
    "approvalSlotId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "consumedRequestId" UUID,
    "consumedOperationId" UUID,
    "invalidatedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ConfirmationTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."PrincipalStamp" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(8) NOT NULL,
    "userId" UUID NOT NULL,
    "webSessionId" UUID,
    "agentCredentialId" UUID,
    "projectId" UUID,
    "roleId" UUID,
    "roleKeySnapshot" VARCHAR(48),
    "scopeSnapshot" TEXT[],
    "userAuthVersion" INTEGER NOT NULL,
    "memberVersion" INTEGER,
    "roleAssignmentVersion" INTEGER,
    "credentialVersion" INTEGER,
    "requestId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrincipalStamp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."AuditEvent" (
    "id" UUID NOT NULL,
    "projectId" UUID,
    "actorStampId" UUID,
    "webhookReceiptId" UUID,
    "action" VARCHAR(64) NOT NULL,
    "targetType" VARCHAR(40) NOT NULL,
    "targetId" UUID NOT NULL,
    "targetVersion" INTEGER,
    "outcome" VARCHAR(16) NOT NULL,
    "reasonCode" VARCHAR(64),
    "details" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."CliAuthorizationRequest" (
    "id" UUID NOT NULL,
    "clientName" VARCHAR(80) NOT NULL,
    "deviceCodeHash" CHAR(64) NOT NULL,
    "userCodeHash" CHAR(64) NOT NULL,
    "codeChallenge" CHAR(43) NOT NULL,
    "codeChallengeMethod" VARCHAR(8) NOT NULL,
    "credentialSecretHash" CHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "nextPollAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedUserId" UUID,
    "approvedProjectId" UUID,
    "approvedRoleId" UUID,
    "approvedScopes" TEXT[],
    "approvedExpiresInDays" INTEGER,
    "approvedByStampId" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "issuedCredentialId" UUID,
    "issuedAt" TIMESTAMPTZ(3),
    "recoveryExpiresAt" TIMESTAMPTZ(3),
    "deniedAt" TIMESTAMPTZ(3),
    "deniedByStampId" UUID,

    CONSTRAINT "CliAuthorizationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."CliAuthorizationView" (
    "authorizationRequestId" UUID NOT NULL,
    "webSessionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "viewedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CliAuthorizationView_pkey" PRIMARY KEY ("authorizationRequestId","webSessionId")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."AuthRateWindow" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "keyHash" CHAR(64) NOT NULL,
    "windowStart" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AuthRateWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."IdempotentOperation" (
    "id" UUID NOT NULL,
    "projectId" UUID,
    "projectScopeKey" VARCHAR(80) NOT NULL,
    "principalScopeKey" VARCHAR(80) NOT NULL,
    "key" UUID NOT NULL,
    "method" VARCHAR(8) NOT NULL,
    "route" VARCHAR(200) NOT NULL,
    "requestDigest" CHAR(64) NOT NULL,
    "resultRefs" JSONB NOT NULL,
    "responseMetadata" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotentOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."CodeReviewEvidence" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "repositoryId" VARCHAR(120) NOT NULL,
    "changeRequestId" VARCHAR(120) NOT NULL,
    "headSha" CHAR(40) NOT NULL,
    "authorExternalId" VARCHAR(120) NOT NULL,
    "reviewerExternalId" VARCHAR(120) NOT NULL,
    "reviewerKind" "workmesh_v1"."ReviewerKind" NOT NULL,
    "state" "workmesh_v1"."ReviewEvidenceState" NOT NULL,
    "commitSha" CHAR(40),
    "submittedAt" TIMESTAMPTZ(3),
    "reviewExternalId" VARCHAR(120) NOT NULL,
    "artifactSetId" UUID,
    "evidenceFingerprint" CHAR(64) NOT NULL,
    "preparedSecretHash" CHAR(64),
    "preparedExpiresAt" TIMESTAMPTZ(3),
    "preparedEvidenceId" UUID,
    "ticketGeneration" INTEGER,
    "receiptId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CodeReviewEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."WebhookReceipt" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "source" "workmesh_v1"."WebhookSource" NOT NULL,
    "eventType" VARCHAR(64) NOT NULL,
    "deliveryId" VARCHAR(120) NOT NULL,
    "signatureValid" BOOLEAN NOT NULL,
    "payloadDigest" CHAR(64) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),
    "status" VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    "errorMessage" VARCHAR(400),

    CONSTRAINT "WebhookReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."RolePackageVersion" (
    "id" UUID NOT NULL,
    "projectId" UUID,
    "packageId" VARCHAR(64) NOT NULL,
    "version" VARCHAR(64) NOT NULL,
    "roleKey" VARCHAR(48) NOT NULL,
    "manifest" JSONB NOT NULL,
    "manifestDigest" CHAR(64) NOT NULL,
    "createdByStampId" UUID,
    "sourceRef" VARCHAR(200),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RolePackageVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."RolePackageResource" (
    "id" UUID NOT NULL,
    "rolePackageVersionId" UUID NOT NULL,
    "resourceKey" VARCHAR(64) NOT NULL,
    "path" VARCHAR(300) NOT NULL,
    "mediaType" VARCHAR(100) NOT NULL,
    "byteLength" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "bodyBytes" BYTEA NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RolePackageResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."ProjectRepository" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "adapter" VARCHAR(16) NOT NULL,
    "externalId" VARCHAR(120) NOT NULL,
    "owner" VARCHAR(120) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "defaultBranch" VARCHAR(200),
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectRepository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workmesh_v1"."SnapshotResourceRef" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "snapshotId" UUID NOT NULL,
    "refKey" VARCHAR(80) NOT NULL,
    "kind" "workmesh_v1"."SnapshotRefKind" NOT NULL,
    "documentRevisionId" UUID,
    "artifactId" UUID,
    "rolePackageResourceId" UUID,
    "sha256" CHAR(64) NOT NULL,
    "byteLength" INTEGER NOT NULL,
    "mediaType" VARCHAR(100) NOT NULL,
    "authority" "workmesh_v1"."SnapshotAuthority" NOT NULL,

    CONSTRAINT "SnapshotResourceRef_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "workmesh_v1"."User"("email");

-- CreateIndex
CREATE INDEX "Project_archivedAt_idx" ON "workmesh_v1"."Project"("archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Project_key_key" ON "workmesh_v1"."Project"("key");

-- CreateIndex
CREATE INDEX "ProjectMember_userId_revokedAt_idx" ON "workmesh_v1"."ProjectMember"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "ProjectRole_projectId_isActive_idx" ON "workmesh_v1"."ProjectRole"("projectId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectRole_projectId_key_key" ON "workmesh_v1"."ProjectRole"("projectId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectRole_id_projectId_key" ON "workmesh_v1"."ProjectRole"("id", "projectId");

-- CreateIndex
CREATE INDEX "ProjectRoleAssignment_projectId_roleId_revokedAt_idx" ON "workmesh_v1"."ProjectRoleAssignment"("projectId", "roleId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectRoleAssignment_projectId_userId_roleId_key" ON "workmesh_v1"."ProjectRoleAssignment"("projectId", "userId", "roleId");

-- CreateIndex
CREATE INDEX "KnowledgeBase_projectId_archivedAt_idx" ON "workmesh_v1"."KnowledgeBase"("projectId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeBase_projectId_key_key" ON "workmesh_v1"."KnowledgeBase"("projectId", "key");

-- CreateIndex
CREATE INDEX "KnowledgeBaseGrant_knowledgeBaseId_revokedAt_idx" ON "workmesh_v1"."KnowledgeBaseGrant"("knowledgeBaseId", "revokedAt");

-- CreateIndex
CREATE INDEX "KnowledgeDocument_projectId_knowledgeBaseId_idx" ON "workmesh_v1"."KnowledgeDocument"("projectId", "knowledgeBaseId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeDocument_id_projectId_key" ON "workmesh_v1"."KnowledgeDocument"("id", "projectId");

-- CreateIndex
CREATE INDEX "DocumentRevision_projectId_sha256_idx" ON "workmesh_v1"."DocumentRevision"("projectId", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentRevision_documentId_seq_key" ON "workmesh_v1"."DocumentRevision"("documentId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentRevision_id_projectId_key" ON "workmesh_v1"."DocumentRevision"("id", "projectId");

-- CreateIndex
CREATE INDEX "DocumentPublication_documentId_createdAt_idx" ON "workmesh_v1"."DocumentPublication"("documentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Requirement_projectId_seq_key" ON "workmesh_v1"."Requirement"("projectId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "Requirement_projectId_code_key" ON "workmesh_v1"."Requirement"("projectId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Requirement_id_projectId_key" ON "workmesh_v1"."Requirement"("id", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "WebSession_tokenHash_key" ON "workmesh_v1"."WebSession"("tokenHash");

-- CreateIndex
CREATE INDEX "WebSession_userId_revokedAt_expiresAt_idx" ON "workmesh_v1"."WebSession"("userId", "revokedAt", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentCredential_tokenHash_key" ON "workmesh_v1"."AgentCredential"("tokenHash");

-- CreateIndex
CREATE INDEX "AgentCredential_projectId_revokedAt_expiresAt_idx" ON "workmesh_v1"."AgentCredential"("projectId", "revokedAt", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowDefinition_projectId_workflowKey_key" ON "workmesh_v1"."WorkflowDefinition"("projectId", "workflowKey");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowRevision_definitionId_revision_key" ON "workmesh_v1"."WorkflowRevision"("definitionId", "revision");

-- CreateIndex
CREATE INDEX "WorkflowInstance_requirementId_retiredAt_idx" ON "workmesh_v1"."WorkflowInstance"("requirementId", "retiredAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowInstance_id_projectId_key" ON "workmesh_v1"."WorkflowInstance"("id", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Task_workflowInstanceId_stepKey_key" ON "workmesh_v1"."Task"("workflowInstanceId", "stepKey");

-- CreateIndex
CREATE UNIQUE INDEX "Task_id_projectId_key" ON "workmesh_v1"."Task"("id", "projectId");

-- CreateIndex
CREATE INDEX "TaskClaim_taskId_releasedAt_idx" ON "workmesh_v1"."TaskClaim"("taskId", "releasedAt");

-- CreateIndex
CREATE INDEX "ContextSnapshot_taskId_taskGeneration_idx" ON "workmesh_v1"."ContextSnapshot"("taskId", "taskGeneration");

-- CreateIndex
CREATE INDEX "ContextSnapshot_requirementId_requirementGeneration_idx" ON "workmesh_v1"."ContextSnapshot"("requirementId", "requirementGeneration");

-- CreateIndex
CREATE UNIQUE INDEX "ContextSnapshot_id_projectId_key" ON "workmesh_v1"."ContextSnapshot"("id", "projectId");

-- CreateIndex
CREATE INDEX "ProjectKnowledgeBinding_projectId_roleId_idx" ON "workmesh_v1"."ProjectKnowledgeBinding"("projectId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectKnowledgeBinding_projectId_documentId_roleId_key" ON "workmesh_v1"."ProjectKnowledgeBinding"("projectId", "documentId", "roleId");

-- CreateIndex
CREATE INDEX "ArtifactSet_taskId_taskGeneration_idx" ON "workmesh_v1"."ArtifactSet"("taskId", "taskGeneration");

-- CreateIndex
CREATE UNIQUE INDEX "ArtifactSet_id_projectId_key" ON "workmesh_v1"."ArtifactSet"("id", "projectId");

-- CreateIndex
CREATE INDEX "ArtifactSetItem_candidateRevisionId_idx" ON "workmesh_v1"."ArtifactSetItem"("candidateRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "ArtifactSetItem_artifactSetId_artifactId_key" ON "workmesh_v1"."ArtifactSetItem"("artifactSetId", "artifactId");

-- CreateIndex
CREATE UNIQUE INDEX "ArtifactSetItem_artifactSetId_candidateRevisionId_key" ON "workmesh_v1"."ArtifactSetItem"("artifactSetId", "candidateRevisionId");

-- CreateIndex
CREATE INDEX "Artifact_taskId_kind_idx" ON "workmesh_v1"."Artifact"("taskId", "kind");

-- CreateIndex
CREATE INDEX "ReviewRequest_projectId_status_idx" ON "workmesh_v1"."ReviewRequest"("projectId", "status");

-- CreateIndex
CREATE INDEX "ReviewRequest_documentRevisionId_status_idx" ON "workmesh_v1"."ReviewRequest"("documentRevisionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewRequest_id_projectId_key" ON "workmesh_v1"."ReviewRequest"("id", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalSlot_reviewRequestId_slotKey_key" ON "workmesh_v1"."ApprovalSlot"("reviewRequestId", "slotKey");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalSlot_id_projectId_key" ON "workmesh_v1"."ApprovalSlot"("id", "projectId");

-- CreateIndex
CREATE INDEX "ReviewDecision_approvalSlotId_idx" ON "workmesh_v1"."ReviewDecision"("approvalSlotId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewDecision_reviewRequestId_approvalSlotId_key" ON "workmesh_v1"."ReviewDecision"("reviewRequestId", "approvalSlotId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewDecisionRevocation_decisionId_key" ON "workmesh_v1"."ReviewDecisionRevocation"("decisionId");

-- CreateIndex
CREATE INDEX "ChangeEvent_projectId_createdAt_idx" ON "workmesh_v1"."ChangeEvent"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ChangeRecipient_userId_ackedAt_createdAt_idx" ON "workmesh_v1"."ChangeRecipient"("userId", "ackedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConfirmationTicket_secretHash_key" ON "workmesh_v1"."ConfirmationTicket"("secretHash");

-- CreateIndex
CREATE INDEX "ConfirmationTicket_webSessionId_expiresAt_idx" ON "workmesh_v1"."ConfirmationTicket"("webSessionId", "expiresAt");

-- CreateIndex
CREATE INDEX "ConfirmationTicket_userId_action_targetId_idx" ON "workmesh_v1"."ConfirmationTicket"("userId", "action", "targetId");

-- CreateIndex
CREATE INDEX "ConfirmationTicket_expiresAt_idx" ON "workmesh_v1"."ConfirmationTicket"("expiresAt");

-- CreateIndex
CREATE INDEX "PrincipalStamp_projectId_createdAt_idx" ON "workmesh_v1"."PrincipalStamp"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "PrincipalStamp_userId_createdAt_idx" ON "workmesh_v1"."PrincipalStamp"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PrincipalStamp_agentCredentialId_createdAt_idx" ON "workmesh_v1"."PrincipalStamp"("agentCredentialId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_projectId_createdAt_idx" ON "workmesh_v1"."AuditEvent"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_targetType_targetId_createdAt_idx" ON "workmesh_v1"."AuditEvent"("targetType", "targetId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actorStampId_idx" ON "workmesh_v1"."AuditEvent"("actorStampId");

-- CreateIndex
CREATE UNIQUE INDEX "CliAuthorizationRequest_deviceCodeHash_key" ON "workmesh_v1"."CliAuthorizationRequest"("deviceCodeHash");

-- CreateIndex
CREATE UNIQUE INDEX "CliAuthorizationRequest_userCodeHash_key" ON "workmesh_v1"."CliAuthorizationRequest"("userCodeHash");

-- CreateIndex
CREATE UNIQUE INDEX "CliAuthorizationRequest_issuedCredentialId_key" ON "workmesh_v1"."CliAuthorizationRequest"("issuedCredentialId");

-- CreateIndex
CREATE INDEX "CliAuthorizationRequest_status_expiresAt_idx" ON "workmesh_v1"."CliAuthorizationRequest"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "CliAuthorizationRequest_approvedUserId_createdAt_idx" ON "workmesh_v1"."CliAuthorizationRequest"("approvedUserId", "createdAt");

-- CreateIndex
CREATE INDEX "CliAuthorizationView_webSessionId_expiresAt_idx" ON "workmesh_v1"."CliAuthorizationView"("webSessionId", "expiresAt");

-- CreateIndex
CREATE INDEX "AuthRateWindow_expiresAt_idx" ON "workmesh_v1"."AuthRateWindow"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuthRateWindow_kind_keyHash_windowStart_key" ON "workmesh_v1"."AuthRateWindow"("kind", "keyHash", "windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotentOperation_projectScopeKey_principalScopeKey_key_key" ON "workmesh_v1"."IdempotentOperation"("projectScopeKey", "principalScopeKey", "key");

-- CreateIndex
CREATE INDEX "CodeReviewEvidence_projectId_repositoryId_changeRequestId_idx" ON "workmesh_v1"."CodeReviewEvidence"("projectId", "repositoryId", "changeRequestId");

-- CreateIndex
CREATE INDEX "CodeReviewEvidence_artifactSetId_idx" ON "workmesh_v1"."CodeReviewEvidence"("artifactSetId");

-- CreateIndex
CREATE UNIQUE INDEX "CodeReviewEvidence_evidenceFingerprint_key" ON "workmesh_v1"."CodeReviewEvidence"("evidenceFingerprint");

-- CreateIndex
CREATE INDEX "WebhookReceipt_projectId_receivedAt_idx" ON "workmesh_v1"."WebhookReceipt"("projectId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookReceipt_source_deliveryId_key" ON "workmesh_v1"."WebhookReceipt"("source", "deliveryId");

-- CreateIndex
CREATE INDEX "RolePackageVersion_packageId_version_idx" ON "workmesh_v1"."RolePackageVersion"("packageId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "RolePackageVersion_projectId_packageId_version_key" ON "workmesh_v1"."RolePackageVersion"("projectId", "packageId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "RolePackageResource_rolePackageVersionId_resourceKey_key" ON "workmesh_v1"."RolePackageResource"("rolePackageVersionId", "resourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "RolePackageResource_rolePackageVersionId_path_key" ON "workmesh_v1"."RolePackageResource"("rolePackageVersionId", "path");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectRepository_projectId_adapter_externalId_key" ON "workmesh_v1"."ProjectRepository"("projectId", "adapter", "externalId");

-- CreateIndex
CREATE INDEX "SnapshotResourceRef_documentRevisionId_idx" ON "workmesh_v1"."SnapshotResourceRef"("documentRevisionId");

-- CreateIndex
CREATE INDEX "SnapshotResourceRef_artifactId_idx" ON "workmesh_v1"."SnapshotResourceRef"("artifactId");

-- CreateIndex
CREATE UNIQUE INDEX "SnapshotResourceRef_snapshotId_refKey_key" ON "workmesh_v1"."SnapshotResourceRef"("snapshotId", "refKey");

-- AddForeignKey
ALTER TABLE "workmesh_v1"."ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "workmesh_v1"."Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "workmesh_v1"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."ProjectRole" ADD CONSTRAINT "ProjectRole_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "workmesh_v1"."Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."ProjectRoleAssignment" ADD CONSTRAINT "ProjectRoleAssignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "workmesh_v1"."Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."ProjectRoleAssignment" ADD CONSTRAINT "ProjectRoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "workmesh_v1"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."ProjectRoleAssignment" ADD CONSTRAINT "ProjectRoleAssignment_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "workmesh_v1"."ProjectRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."KnowledgeBase" ADD CONSTRAINT "KnowledgeBase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "workmesh_v1"."Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."KnowledgeBase" ADD CONSTRAINT "KnowledgeBase_publicationApproverUserId_fkey" FOREIGN KEY ("publicationApproverUserId") REFERENCES "workmesh_v1"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."KnowledgeBase" ADD CONSTRAINT "KnowledgeBase_publicationApproverRoleId_fkey" FOREIGN KEY ("publicationApproverRoleId") REFERENCES "workmesh_v1"."ProjectRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."KnowledgeBaseGrant" ADD CONSTRAINT "KnowledgeBaseGrant_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "workmesh_v1"."Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."KnowledgeBaseGrant" ADD CONSTRAINT "KnowledgeBaseGrant_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "workmesh_v1"."KnowledgeBase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."KnowledgeBaseGrant" ADD CONSTRAINT "KnowledgeBaseGrant_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "workmesh_v1"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."KnowledgeBaseGrant" ADD CONSTRAINT "KnowledgeBaseGrant_subjectRoleId_fkey" FOREIGN KEY ("subjectRoleId") REFERENCES "workmesh_v1"."ProjectRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "workmesh_v1"."Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "workmesh_v1"."KnowledgeBase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."DocumentRevision" ADD CONSTRAINT "DocumentRevision_documentId_projectId_fkey" FOREIGN KEY ("documentId", "projectId") REFERENCES "workmesh_v1"."KnowledgeDocument"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."DocumentRevision" ADD CONSTRAINT "DocumentRevision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "workmesh_v1"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."DocumentPublication" ADD CONSTRAINT "DocumentPublication_revisionId_projectId_fkey" FOREIGN KEY ("revisionId", "projectId") REFERENCES "workmesh_v1"."DocumentRevision"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."Requirement" ADD CONSTRAINT "Requirement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "workmesh_v1"."Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."Requirement" ADD CONSTRAINT "Requirement_currentUnderstandingRevisionId_fkey" FOREIGN KEY ("currentUnderstandingRevisionId") REFERENCES "workmesh_v1"."DocumentRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."Requirement" ADD CONSTRAINT "Requirement_currentPrdRevisionId_fkey" FOREIGN KEY ("currentPrdRevisionId") REFERENCES "workmesh_v1"."DocumentRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."WebSession" ADD CONSTRAINT "WebSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "workmesh_v1"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."AgentCredential" ADD CONSTRAINT "AgentCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "workmesh_v1"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."AgentCredential" ADD CONSTRAINT "AgentCredential_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "workmesh_v1"."Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."AgentCredential" ADD CONSTRAINT "AgentCredential_roleId_projectId_fkey" FOREIGN KEY ("roleId", "projectId") REFERENCES "workmesh_v1"."ProjectRole"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."AgentCredential" ADD CONSTRAINT "AgentCredential_authorizedByStampId_fkey" FOREIGN KEY ("authorizedByStampId") REFERENCES "workmesh_v1"."PrincipalStamp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."WorkflowDefinition" ADD CONSTRAINT "WorkflowDefinition_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "workmesh_v1"."Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."WorkflowRevision" ADD CONSTRAINT "WorkflowRevision_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "workmesh_v1"."WorkflowDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."WorkflowInstance" ADD CONSTRAINT "WorkflowInstance_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "workmesh_v1"."WorkflowDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."WorkflowInstance" ADD CONSTRAINT "WorkflowInstance_requirementId_projectId_fkey" FOREIGN KEY ("requirementId", "projectId") REFERENCES "workmesh_v1"."Requirement"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."Task" ADD CONSTRAINT "Task_workflowInstanceId_projectId_fkey" FOREIGN KEY ("workflowInstanceId", "projectId") REFERENCES "workmesh_v1"."WorkflowInstance"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."Task" ADD CONSTRAINT "Task_roleId_projectId_fkey" FOREIGN KEY ("roleId", "projectId") REFERENCES "workmesh_v1"."ProjectRole"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."Task" ADD CONSTRAINT "Task_responsibleUserId_fkey" FOREIGN KEY ("responsibleUserId") REFERENCES "workmesh_v1"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."TaskClaim" ADD CONSTRAINT "TaskClaim_taskId_projectId_fkey" FOREIGN KEY ("taskId", "projectId") REFERENCES "workmesh_v1"."Task"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."TaskClaim" ADD CONSTRAINT "TaskClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "workmesh_v1"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."ContextSnapshot" ADD CONSTRAINT "ContextSnapshot_taskId_projectId_fkey" FOREIGN KEY ("taskId", "projectId") REFERENCES "workmesh_v1"."Task"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."ContextSnapshot" ADD CONSTRAINT "ContextSnapshot_requirementId_projectId_fkey" FOREIGN KEY ("requirementId", "projectId") REFERENCES "workmesh_v1"."Requirement"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."ContextSnapshot" ADD CONSTRAINT "ContextSnapshot_workflowDefinitionRevisionId_fkey" FOREIGN KEY ("workflowDefinitionRevisionId") REFERENCES "workmesh_v1"."WorkflowRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."ContextSnapshot" ADD CONSTRAINT "ContextSnapshot_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "workmesh_v1"."TaskClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."ContextSnapshot" ADD CONSTRAINT "ContextSnapshot_createdByStampId_fkey" FOREIGN KEY ("createdByStampId") REFERENCES "workmesh_v1"."PrincipalStamp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."ProjectKnowledgeBinding" ADD CONSTRAINT "ProjectKnowledgeBinding_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "workmesh_v1"."Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."ProjectKnowledgeBinding" ADD CONSTRAINT "ProjectKnowledgeBinding_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "workmesh_v1"."KnowledgeDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."ProjectKnowledgeBinding" ADD CONSTRAINT "ProjectKnowledgeBinding_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "workmesh_v1"."ProjectRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."ProjectKnowledgeBinding" ADD CONSTRAINT "ProjectKnowledgeBinding_createdByStampId_fkey" FOREIGN KEY ("createdByStampId") REFERENCES "workmesh_v1"."PrincipalStamp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."ArtifactSet" ADD CONSTRAINT "ArtifactSet_taskId_projectId_fkey" FOREIGN KEY ("taskId", "projectId") REFERENCES "workmesh_v1"."Task"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."ArtifactSet" ADD CONSTRAINT "ArtifactSet_workflowDefinitionRevisionId_fkey" FOREIGN KEY ("workflowDefinitionRevisionId") REFERENCES "workmesh_v1"."WorkflowRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."ArtifactSet" ADD CONSTRAINT "ArtifactSet_createdByStampId_fkey" FOREIGN KEY ("createdByStampId") REFERENCES "workmesh_v1"."PrincipalStamp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."ArtifactSetItem" ADD CONSTRAINT "ArtifactSetItem_artifactSetId_projectId_fkey" FOREIGN KEY ("artifactSetId", "projectId") REFERENCES "workmesh_v1"."ArtifactSet"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."ArtifactSetItem" ADD CONSTRAINT "ArtifactSetItem_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "workmesh_v1"."Artifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."ArtifactSetItem" ADD CONSTRAINT "ArtifactSetItem_candidateRevisionId_fkey" FOREIGN KEY ("candidateRevisionId") REFERENCES "workmesh_v1"."DocumentRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."Artifact" ADD CONSTRAINT "Artifact_artifactSetId_projectId_fkey" FOREIGN KEY ("artifactSetId", "projectId") REFERENCES "workmesh_v1"."ArtifactSet"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."Artifact" ADD CONSTRAINT "Artifact_submittedByStampId_fkey" FOREIGN KEY ("submittedByStampId") REFERENCES "workmesh_v1"."PrincipalStamp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."ReviewRequest" ADD CONSTRAINT "ReviewRequest_documentRevisionId_fkey" FOREIGN KEY ("documentRevisionId") REFERENCES "workmesh_v1"."DocumentRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."ReviewRequest" ADD CONSTRAINT "ReviewRequest_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "workmesh_v1"."Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."ApprovalSlot" ADD CONSTRAINT "ApprovalSlot_reviewRequestId_projectId_fkey" FOREIGN KEY ("reviewRequestId", "projectId") REFERENCES "workmesh_v1"."ReviewRequest"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."ApprovalSlot" ADD CONSTRAINT "ApprovalSlot_requiredUserId_fkey" FOREIGN KEY ("requiredUserId") REFERENCES "workmesh_v1"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."ApprovalSlot" ADD CONSTRAINT "ApprovalSlot_requiredRoleId_fkey" FOREIGN KEY ("requiredRoleId") REFERENCES "workmesh_v1"."ProjectRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."ReviewDecision" ADD CONSTRAINT "ReviewDecision_reviewRequestId_projectId_fkey" FOREIGN KEY ("reviewRequestId", "projectId") REFERENCES "workmesh_v1"."ReviewRequest"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."ReviewDecision" ADD CONSTRAINT "ReviewDecision_approvalSlotId_projectId_fkey" FOREIGN KEY ("approvalSlotId", "projectId") REFERENCES "workmesh_v1"."ApprovalSlot"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."ReviewDecision" ADD CONSTRAINT "ReviewDecision_confirmationTicketId_fkey" FOREIGN KEY ("confirmationTicketId") REFERENCES "workmesh_v1"."ConfirmationTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."ReviewDecision" ADD CONSTRAINT "ReviewDecision_createdByStampId_fkey" FOREIGN KEY ("createdByStampId") REFERENCES "workmesh_v1"."PrincipalStamp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."ReviewDecisionRevocation" ADD CONSTRAINT "ReviewDecisionRevocation_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "workmesh_v1"."ReviewDecision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."ReviewDecisionRevocation" ADD CONSTRAINT "ReviewDecisionRevocation_createdByStampId_fkey" FOREIGN KEY ("createdByStampId") REFERENCES "workmesh_v1"."PrincipalStamp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."ChangeRecipient" ADD CONSTRAINT "ChangeRecipient_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "workmesh_v1"."ChangeEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."ChangeRecipient" ADD CONSTRAINT "ChangeRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "workmesh_v1"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."ConfirmationTicket" ADD CONSTRAINT "ConfirmationTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "workmesh_v1"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."ConfirmationTicket" ADD CONSTRAINT "ConfirmationTicket_webSessionId_fkey" FOREIGN KEY ("webSessionId") REFERENCES "workmesh_v1"."WebSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."ConfirmationTicket" ADD CONSTRAINT "ConfirmationTicket_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "workmesh_v1"."Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."ConfirmationTicket" ADD CONSTRAINT "ConfirmationTicket_approvalSlotId_fkey" FOREIGN KEY ("approvalSlotId") REFERENCES "workmesh_v1"."ApprovalSlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."ConfirmationTicket" ADD CONSTRAINT "ConfirmationTicket_consumedOperationId_fkey" FOREIGN KEY ("consumedOperationId") REFERENCES "workmesh_v1"."IdempotentOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."PrincipalStamp" ADD CONSTRAINT "PrincipalStamp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "workmesh_v1"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."PrincipalStamp" ADD CONSTRAINT "PrincipalStamp_webSessionId_fkey" FOREIGN KEY ("webSessionId") REFERENCES "workmesh_v1"."WebSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."PrincipalStamp" ADD CONSTRAINT "PrincipalStamp_agentCredentialId_fkey" FOREIGN KEY ("agentCredentialId") REFERENCES "workmesh_v1"."AgentCredential"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."PrincipalStamp" ADD CONSTRAINT "PrincipalStamp_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "workmesh_v1"."Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."AuditEvent" ADD CONSTRAINT "AuditEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "workmesh_v1"."Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."AuditEvent" ADD CONSTRAINT "AuditEvent_actorStampId_fkey" FOREIGN KEY ("actorStampId") REFERENCES "workmesh_v1"."PrincipalStamp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."CliAuthorizationRequest" ADD CONSTRAINT "CliAuthorizationRequest_approvedUserId_fkey" FOREIGN KEY ("approvedUserId") REFERENCES "workmesh_v1"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."CliAuthorizationRequest" ADD CONSTRAINT "CliAuthorizationRequest_approvedByStampId_fkey" FOREIGN KEY ("approvedByStampId") REFERENCES "workmesh_v1"."PrincipalStamp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."CliAuthorizationRequest" ADD CONSTRAINT "CliAuthorizationRequest_deniedByStampId_fkey" FOREIGN KEY ("deniedByStampId") REFERENCES "workmesh_v1"."PrincipalStamp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."CliAuthorizationRequest" ADD CONSTRAINT "CliAuthorizationRequest_issuedCredentialId_fkey" FOREIGN KEY ("issuedCredentialId") REFERENCES "workmesh_v1"."AgentCredential"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."CliAuthorizationView" ADD CONSTRAINT "CliAuthorizationView_authorizationRequestId_fkey" FOREIGN KEY ("authorizationRequestId") REFERENCES "workmesh_v1"."CliAuthorizationRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."CliAuthorizationView" ADD CONSTRAINT "CliAuthorizationView_webSessionId_fkey" FOREIGN KEY ("webSessionId") REFERENCES "workmesh_v1"."WebSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."CliAuthorizationView" ADD CONSTRAINT "CliAuthorizationView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "workmesh_v1"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."IdempotentOperation" ADD CONSTRAINT "IdempotentOperation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "workmesh_v1"."Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."CodeReviewEvidence" ADD CONSTRAINT "CodeReviewEvidence_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "workmesh_v1"."Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."CodeReviewEvidence" ADD CONSTRAINT "CodeReviewEvidence_artifactSetId_fkey" FOREIGN KEY ("artifactSetId") REFERENCES "workmesh_v1"."ArtifactSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."CodeReviewEvidence" ADD CONSTRAINT "CodeReviewEvidence_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "workmesh_v1"."WebhookReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."WebhookReceipt" ADD CONSTRAINT "WebhookReceipt_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "workmesh_v1"."Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."RolePackageVersion" ADD CONSTRAINT "RolePackageVersion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "workmesh_v1"."Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."RolePackageVersion" ADD CONSTRAINT "RolePackageVersion_createdByStampId_fkey" FOREIGN KEY ("createdByStampId") REFERENCES "workmesh_v1"."PrincipalStamp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."RolePackageResource" ADD CONSTRAINT "RolePackageResource_rolePackageVersionId_fkey" FOREIGN KEY ("rolePackageVersionId") REFERENCES "workmesh_v1"."RolePackageVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."ProjectRepository" ADD CONSTRAINT "ProjectRepository_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "workmesh_v1"."Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."SnapshotResourceRef" ADD CONSTRAINT "SnapshotResourceRef_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "workmesh_v1"."ContextSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workmesh_v1"."SnapshotResourceRef" ADD CONSTRAINT "SnapshotResourceRef_rolePackageResourceId_fkey" FOREIGN KEY ("rolePackageResourceId") REFERENCES "workmesh_v1"."RolePackageResource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 同一项目 + 文档的“全项目角色”绑定在 PostgreSQL 唯一约束下会被 NULL 视为互不相同，需显式部分唯一索引。
CREATE UNIQUE INDEX "ProjectKnowledgeBinding_projectId_documentId_role_null_key"
  ON "workmesh_v1"."ProjectKnowledgeBinding"("projectId", "documentId")
  WHERE "roleId" IS NULL;

-- 工件条目目标精确一项：要么指向已提交工件，要么指向候选修订。
ALTER TABLE "workmesh_v1"."ArtifactSetItem"
  ADD CONSTRAINT "artifact_set_item_target_ck"
  CHECK (("artifactId" IS NOT NULL) <> ("candidateRevisionId" IS NOT NULL));

-- HOSTED 与 GIT_REF 的定位字段精确二选一，不允许同时持有两套来源。
ALTER TABLE "workmesh_v1"."Artifact"
  ADD CONSTRAINT "artifact_storage_ck"
  CHECK (
    ("storage" = 'HOSTED' AND "bodyBytes" IS NOT NULL AND "projectRepositoryId" IS NULL AND "commitSha" IS NULL AND "repoPath" IS NULL)
    OR
    ("storage" = 'GIT_REF' AND "bodyBytes" IS NULL AND "projectRepositoryId" IS NOT NULL AND "commitSha" IS NOT NULL AND "repoPath" IS NOT NULL)
  );

