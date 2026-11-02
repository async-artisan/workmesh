-- Add project description so the value already collected by the web form is persisted end to end.
ALTER TABLE "workmesh_v1"."Project" ADD COLUMN "description" VARCHAR(10000);
