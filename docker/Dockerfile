FROM node:20.19-bookworm-slim AS build

WORKDIR /workspace

RUN apt-get update \
  && apt-get install --no-install-recommends --yes ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/* \
  && npm install --global pnpm@10.28.2 \
  && pnpm --version

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/cli/package.json apps/cli/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/box/package.json packages/box/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/role-packages/package.json packages/role-packages/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/ui/package.json packages/ui/package.json

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm build

FROM node:20.19-bookworm-slim AS runtime

WORKDIR /workspace

RUN apt-get update \
  && apt-get install --no-install-recommends --yes ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/* \
  && npm install --global pnpm@10.28.2 \
  && pnpm --version \
  && groupadd --system --gid 1001 workmesh \
  && useradd --system --uid 1001 --gid workmesh --home-dir /workspace --shell /usr/sbin/nologin workmesh

# Keep the workspace layout in the local deployment image. pnpm workspace links and
# Prisma's generated client then resolve exactly as they do during the build.
COPY --from=build --chown=workmesh:workmesh /workspace ./

ENV NODE_ENV=production \
    PORT=3000 \
    WEB_PORT=5173 \
    WEB_HOST=0.0.0.0

EXPOSE 5173

USER workmesh

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=12 \
  CMD node docker/healthcheck.mjs

ENTRYPOINT ["node", "docker/entrypoint.mjs"]
