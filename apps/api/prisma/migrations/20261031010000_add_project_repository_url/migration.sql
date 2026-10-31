ALTER TABLE "projects" ADD COLUMN "repository_url" TEXT;
CREATE UNIQUE INDEX "projects_repository_url_key" ON "projects"("repository_url");

ALTER TABLE "git_commits" ADD COLUMN "repository_url" TEXT;
DROP INDEX "git_commits_sha_key";
CREATE UNIQUE INDEX "git_commits_repository_url_sha_key" ON "git_commits"("repository_url", "sha");

ALTER TABLE "pull_requests" ADD COLUMN "repository_url" TEXT;
