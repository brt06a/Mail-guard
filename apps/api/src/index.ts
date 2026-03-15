import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import {
  validateEnv,
  getPrismaClient,
  closePrismaClient,
  getRedisClient,
  closeRedisClient,
  getLogger,
  createRequestLogger,
} from '@mailguard/core';
import { authMiddleware } from './middleware/auth';
import { addSecurityHeaders, enforceHttps, logRequest } from './middleware/security';
import { checkApiKeyRateLimit, sendRateLimitResponse } from './middleware/ratelimit';
import { registerOtpRoutes } from './routes/otp';
import { registerHealthRoutes } from './routes/health';
import { registerEmailRoutes } from './routes/email';
import { registerLogsRoutes } from './routes/logs';
import { generateRequestId } from './utils/request';

const logger = getLogger('api:server');

// Validate environment on startup
const env = validateEnv();

// Create Fastify instance
const fastify = Fastify({
  logger: false, // We use pino directly
  genReqId: () => generateRequestId(),
  requestIdHeader: 'x-request-id',
});

// Register plugins
async function registerPlugins(): Promise<void> {
  // Security headers
  await fastify.register(helmet, {
    contentSecurityPolicy: false, // We're an API, not serving HTML
  });
  
  // CORS
  await fastify.register(cors, {
    origin: true, // Allow all origins in development
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  });
}

// Register hooks
function registerHooks(): void {
  // Security hooks
  fastify.addHook('onRequest', enforceHttps);
  fastify.addHook('onRequest', (request, reply, done) => {
    addSecurityHeaders(request, reply);
    done();
  });
  fastify.addHook('onRequest', logRequest);
  
  // Auth hook for protected routes
  fastify.addHook('onRequest', async (request, reply) => {
    // Skip auth for health endpoint
    if (request.url === '/health' || request.url === '/bot-health') {
      return;
    }
    
    // Apply auth middleware
    await authMiddleware(request, reply);
    
    // Check API key rate limit
    const auth = request.headers.authorization;
    if (auth) {
      const token = auth.split(' ')[1];
      if (token) {
        const rateLimit = await checkApiKeyRateLimit(token);
        if (!rateLimit.allowed) {
          return sendRateLimitResponse(reply, rateLimit.retryAfter!);
        }
      }
    }
  });
}

// Register routes
async function registerRoutes(): Promise<void> {
  await registerHealthRoutes(fastify);
  await registerOtpRoutes(fastify);
  await registerEmailRoutes(fastify);
  await registerLogsRoutes(fastify);
}

// Error handler
function setupErrorHandler(): void {
  fastify.setErrorHandler((error, request, reply) => {
    const requestId = request.id;
    const log = createRequestLogger('api', requestId);
    
    log.error({ error: error.message, stack: error.stack }, 'Unhandled error');
    
    // Don't expose internal errors to clients
    reply.status(500).send({
      error: 'internal_error',
      message: 'An unexpected error occurred',
    });
  });
}

// Graceful shutdown
async function setupGracefulShutdown(): Promise<void> {
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, starting graceful shutdown...`);
    
    try {
      // Stop accepting new connections
      await fastify.close();
      
      // Close database connection
      await closePrismaClient();
      
      // Close Redis connection
      await closeRedisClient();
      
      logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error({ error }, 'Error during shutdown');
      process.exit(1);
    }
  };
  
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  
  // Handle unhandled rejections
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled rejection');
  });
  
  process.on('uncaughtException', (error) => {
    logger.error({ error: error.message, stack: error.stack }, 'Uncaught exception');
    process.exit(1);
  });
}

// Start server
async function start(): Promise<void> {
  try {
    // Initialize connections
    logger.info('Initializing database connection...');
    const prisma = getPrismaClient();
    await prisma.$connect();
    
    logger.info('Initializing Redis connection...');
    await getRedisClient();
    
    // Register plugins, hooks, routes
    await registerPlugins();
    registerHooks();
    await registerRoutes();
    setupErrorHandler();
    await setupGracefulShutdown();
    
    // Start listening
    const port = env.PORT;
    const host = '0.0.0.0';
    
    await fastify.listen({ port, host });
    
    logger.info(`MailGuard API server running on http://${host}:${port}`);
    logger.info(`Environment: ${env.NODE_ENV}`);
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

// Start the server
start();