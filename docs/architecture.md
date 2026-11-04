# WorkMesh architecture

Current delivery and verification boundaries are maintained in [delivery status](phase-status.md). For source navigation and diagrams, see the [code map](code-wiki/ARCHITECTURE.md) and [architecture diagrams](code-wiki/ARCHITECTURE_DIAGRAMS.md). The [documentation index](README.md) separates current guidance, technical contracts and historical records.

WorkMesh is a pnpm workspace. `apps/api` owns the NestJS HTTP boundary and Prisma persistence, `apps/web` is the React workbench, `apps/cli` provides local automation for agents, and `packages/shared` contains cross-app contracts.

The request path is `controller → domain service → repository → Prisma`. Services never trust client-declared identity, roles, versions or approval state: the guard derives a `Principal` (HUMAN WebSession or AGENT bearer credential), then project membership and knowledge-base read access are re-checked per request.

All state-changing domain operations run in a single Serializable transaction with project-row locking, compare-and-set updates on versions, and bounded retries on serialization failures. Identity, decisions, publications, confirmation tickets, idempotent operations and audit events are append-only records: revocations and withdrawals add new records instead of rewriting history.

Agent work is bounded by immutable inputs: a published role-package version, a deterministic `ContextSnapshot`, and a `TaskClaim` generation. Artifacts are accepted only with real bytes or complete code references, and code evidence is normalized from a provider adapter before the platform consumes it. GitHub is the only implemented code host; the adapter interface and stable repository identity keep vendor fields out of the domain layer.
