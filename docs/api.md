# API quick reference

- `GET /api/health` — health probe.
- `GET /api/dashboard` — authenticated workspace summary scoped to the current user's projects.
- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/refresh` — authentication.
- `GET/PATCH /api/auth/profile`, `PATCH /api/auth/password` — authenticated profile and password changes.
- `GET/POST /api/projects`, `PUT/DELETE /api/projects/:id` — member-scoped projects.
- `GET/POST/PATCH/DELETE /api/requirements` — member-scoped requirement lifecycle.
- `GET/POST /api/requirements/:id/prds`, `POST /api/requirements/:id/prds/generate`, `GET /api/requirements/:id/prds/generate-stream` — PRD versions and authenticated SSE generation.
- `GET /api/prds/:id/export?format=html` — escaped HTML export; omit `format` for Markdown.
- `GET/POST /api/knowledge-bases/project/:projectId`, `POST /api/knowledge-bases/:id/upload`, `GET /api/knowledge-bases/:id/search` — knowledge ingestion and hybrid search.
- `GET/POST /api/traces/...` — trace graph and links.
- `POST /api/integrations/git/webhook` — GitHub/GitLab signature or token verified webhook.

Swagger is available at `/api/docs` after the API starts.
