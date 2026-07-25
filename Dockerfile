# Build stage: install dependencies with bun
FROM oven/bun:1-alpine AS build
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install

# Runtime stage
FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY . .
CMD ["node", "--experimental-strip-types", "index.ts"]