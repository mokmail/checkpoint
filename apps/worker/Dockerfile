FROM node:20-alpine

WORKDIR /app

# Copy entire project for npm workspaces
COPY . .

# Install dependencies
RUN npm install --legacy-peer-deps

# Build shared packages first
RUN npx tsc -p packages/config/tsconfig.json && npx tsc -p packages/shared/tsconfig.json

# Build
RUN npx tsc -p apps/worker/tsconfig.json

ENV NODE_ENV=production

CMD ["node", "apps/worker/dist/index.js"]