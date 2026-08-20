# Build stage: install production dependencies
FROM node:22-alpine AS build
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Runtime stage
FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY package.json index.ts tsconfig.json ./
COPY src/ ./src/
RUN chown -R node:node /app
USER node
CMD ["node", "--experimental-strip-types", "index.ts"]