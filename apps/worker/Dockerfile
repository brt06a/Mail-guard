# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/smtp/package.json ./packages/smtp/
COPY apps/worker/package.json ./apps/worker/

# Copy lockfile if exists
COPY package-lock.json* yarn.lock* pnpm-lock.yaml* ./

# Install dependencies
RUN npm install --ignore-scripts

# Copy source code
COPY tsconfig.json ./
COPY packages/core ./packages/core
COPY packages/smtp ./packages/smtp
COPY apps/worker ./apps/worker

# Generate Prisma client before building
RUN npx prisma generate --schema=packages/core/prisma/schema.prisma

# Build packages in order
RUN npm run build --workspace=packages/core
RUN npm run build --workspace=packages/smtp
RUN npm run build --workspace=apps/worker

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Copy built files and node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=builder /app/packages/smtp/dist ./packages/smtp/dist
COPY --from=builder /app/packages/smtp/package.json ./packages/smtp/
COPY --from=builder /app/packages/smtp/node_modules ./packages/smtp/node_modules
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder /app/apps/worker/package.json ./apps/worker/
COPY --from=builder /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=builder /app/packages/core/prisma ./packages/core/prisma

# Set environment
ENV NODE_ENV=production

WORKDIR /app/apps/worker
CMD ["node", "dist/index.js"]