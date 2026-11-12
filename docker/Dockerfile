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

# Copy only production artefacts from the build stage.
# pnpm workspace links and Prisma's generated client rely on the workspace
# layout, so we keep the manifest files and re-install production deps only.
COPY --from=build /workspace/package.json ./package.json
COPY --from=build /workspace/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=build /workspace/pnpm-workspace.yaml ./pnpm-workspace.yaml

COPY --from=build /workspace/apps/api/package.json ./apps/api/package.json
COPY --from=build /workspace/apps/api/dist ./apps/api/dist
COPY --from=build /workspace/apps/api/prisma ./apps/api/prisma

COPY --from=build /workspace/apps/web/package.json ./apps/web/package.json
COPY --from=build /workspace/apps/web/dist ./apps/web/dist

COPY --from=build /workspace/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /workspace/packages/shared/dist ./packages/shared/dist

COPY --from=build /workspace/packages/role-packages/package.json ./packages/role-packages/package.json
COPY --from=build /workspace/packages/role-packages/dist ./packages/role-packages/dist

COPY --from=build /workspace/packages/ui/package.json ./packages/ui/package.json
COPY --from=build /workspace/packages/ui/dist ./packages/ui/dist

COPY --from=build /workspace/packages/config/package.json ./packages/config/package.json

COPY --from=build /workspace/packages/box/package.json ./packages/box/package.json
COPY --from=build /workspace/packages/box/dist ./packages/box/dist

# web-server.mjs is a zero-dependency static file + API proxy server
COPY --from=build /workspace/scripts/box/web-server.mjs ./scripts/box/web-server.mjs

COPY --from=build /workspace/docker ./docker

# Install production dependencies only (no devDependencies, no build tools)
RUN pnpm install --frozen-lockfile --prod \
  && chown -R workmesh:workmesh /workspace

ENV NODE_ENV=production \
    PORT=3000 \
    WEB_PORT=5173 \
    WEB_HOST=0.0.0.0

EXPOSE 5173

USER workmesh

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=12 \
  CMD node docker/healthcheck.mjs

ENTRYPOINT ["node", "docker/entrypoint.mjs"]
