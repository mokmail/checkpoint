FROM node:20-alpine

WORKDIR /app

# Copy entire project for npm workspaces
COPY . .

# Install dependencies
RUN npm install --legacy-peer-deps

# Build shared packages first (web depends on config/shared for types)
RUN npx tsc -p packages/config/tsconfig.json && npx tsc -p packages/shared/tsconfig.json

# Build web bundle with Vite
RUN cd apps/web && npx vite build

ENV NODE_ENV=production

EXPOSE 3500

# Serve the built bundle. Vite preview proxies /api to the api service via vite.config.
CMD ["npx", "vite", "preview", "--config", "apps/web/vite.config.ts", "--port", "3500", "--host", "0.0.0.0"]