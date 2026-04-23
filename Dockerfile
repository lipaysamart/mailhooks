FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --production

COPY src ./src
COPY tsconfig.json ./

VOLUME ["/app/data", "/app/config"]

ENV LOG_LEVEL=info
ENV SYNC_INTERVAL=300
ENV CONFIG_PATH=/app/config/config.yaml
ENV DATABASE_PATH=/app/data/mailhooks.db

CMD ["bun", "run", "src/index.ts"]