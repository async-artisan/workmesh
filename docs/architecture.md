# ReqFlow architecture

ReqFlow is a pnpm workspace. `apps/api` owns the NestJS HTTP boundary and Prisma persistence. `apps/web` is the React dashboard, `apps/cli` provides local automation, and `packages/shared` contains cross-app contracts.

The request path is: controller → service → Prisma/Ai adapter. Authenticated project resources verify membership before reading or writing. AI calls are optional: without provider keys, local deterministic embeddings and a reviewable Markdown draft keep development and tests offline.

Trace links use a polymorphic source/target pair so requirements, PRDs, commits and test artifacts can be connected without exposing credentials or coupling the database to a single provider.
