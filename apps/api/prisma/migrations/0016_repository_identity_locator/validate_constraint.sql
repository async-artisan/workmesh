-- T1 / 0016 constraint validation. Run ONLY after postcheck.sql section 4 returns 0.
-- VALIDATE CONSTRAINT takes a SHARE UPDATE EXCLUSIVE lock and scans the table; schedule a maintenance window.
-- It does not rewrite rows. New writes were already checked while the constraint was NOT VALID.

ALTER TABLE "workmesh_v1"."ProjectRepository"
  VALIDATE CONSTRAINT "ProjectRepository_identity_mode_ck";

SELECT conname, convalidated
FROM pg_constraint
WHERE conrelid = '"workmesh_v1"."ProjectRepository"'::regclass
  AND conname = 'ProjectRepository_identity_mode_ck';
-- Expect convalidated = true after this file succeeds.
