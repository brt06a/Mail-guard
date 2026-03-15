# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/smtp/package.json ./packages/smtp/
COPY apps/api/package.json ./apps/api/

# Copy lockfile if exists
COPY package-lock.json* yarn.lock* pnpm-lock.yaml* ./

# Install dependencies
RUN npm install --ignore-scripts

# Copy source code
COPY tsconfig.json ./
COPY packages/core ./packages/core
COPY packages/smtp ./packages/smtp
COPY apps/api ./apps/api

# Generate Prisma client before building
RUN npx prisma generate --schema=packages/core/prisma/schema.prisma

# Build packages in order
RUN npm run build --workspace=packages/core
RUN npm run build --workspace=packages/smtp
RUN npm run build --workspace=apps/api

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
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/packages/core/prisma ./packages/core/prisma

# Set environment
ENV NODE_ENV=production

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Run migrations and start server
WORKDIR /app/apps/api
CMD ["node", "dist/index.js"]