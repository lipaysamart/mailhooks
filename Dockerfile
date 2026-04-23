FROM oven/bun:1-alpine AS builder

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --production --no-cache

COPY src ./src
COPY tsconfig.json ./

FROM oven/bun:1-alpine

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./

VOLUME ["/app/data", "/app/config"]

ENV LOG_LEVEL=info
ENV SYNC_INTERVAL=300
ENV CONFIG_PATH=/app/config/config.yaml
ENV DATABASE_PATH=/app/data/mailhooks.db

CMD ["bun", "run", "src/index.ts"]