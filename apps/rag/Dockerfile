FROM node:20-bookworm-slim

WORKDIR /app

# OpenSSL is required by Prisma's query engine
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Copy entire project for npm workspaces
COPY . .

# Install dependencies
RUN npm install --legacy-peer-deps

# Build shared packages first
RUN npx tsc -p packages/config/tsconfig.json && npx tsc -p packages/shared/tsconfig.json

# Generate Prisma client (needed for type-checking the rag build)
RUN npx prisma generate --schema apps/api/prisma/schema.prisma

# Build
RUN npx tsc -p apps/rag/tsconfig.json

ENV NODE_ENV=production

EXPOSE 3002

CMD ["node", "apps/rag/dist/index.js"]