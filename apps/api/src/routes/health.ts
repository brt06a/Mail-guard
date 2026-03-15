import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  getPrismaClient,
  checkDatabaseHealth,
  checkRedisHealth,
  getBullMQRedis,
  getLogger,
  HTTP_STATUS,
} from '@mailguard/core';
import { Queue } from 'bullmq';

const logger = getLogger('api:routes:health');

/**
 * GET /health
 * Health check endpoint
 */
export async function registerHealthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/health', async (_request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    
    // Check database
    const dbOk = await checkDatabaseHealth();
    
    // Check Redis
    const redisOk = await checkRedisHealth();
    
    // Check queue
    let queueStatus = { waiting: 0, active: 0 };
    try {
      const redis = getBullMQRedis();
      const emailQueue = new Queue('mailguard:emails', { connection: redis });
      const [waiting, active] = await Promise.all([
        emailQueue.getWaitingCount(),
        emailQueue.getActiveCount(),
      ]);
      queueStatus = { waiting, active };
    } catch (err) {
      logger.warn({ err }, 'Failed to get queue status');
    }
    
    // Check senders
    const senders: Array<{
      id: string;
      email: string;
      provider: string;
      status: 'ok' | 'error';
      daily_limit: number;
      sent_today: number;
    }> = [];
    
    try {
      const prisma = getPrismaClient();
      const senderRecords = await prisma.senderEmail.findMany({
        where: { isActive: true },
        take: 10, // Limit for performance
      });
      
      // Get sent today count for each sender
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      for (const sender of senderRecords) {
        const sentToday = await prisma.emailLog.count({
          where: {
            senderEmailId: sender.id,
            createdAt: { gte: today },
            status: { in: ['sent', 'delivered'] },
          },
        });
        
        senders.push({
          id: sender.id,
          email: sender.emailAddress.replace(/(.{1})[^@]*(@)/, '$1***$2'),
          provider: sender.provider,
          status: sender.isVerified ? 'ok' : 'error',
          daily_limit: sender.dailyLimit,
          sent_today: sentToday,
        });
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to check senders');
    }
    
    // Check bot reachability
    let botStatus: 'ok' | 'error' | 'not_configured' = 'not_configured';
    const internalApiUrl = process.env.INTERNAL_API_URL;
    if (internalApiUrl) {
      try {
        const response = await fetch(`${internalApiUrl}/bot-health`, {
          method: 'GET',
          signal: AbortSignal.timeout(5000),
        });
        botStatus = response.ok ? 'ok' : 'error';
      } catch {
        botStatus = 'error';
      }
    }
    
    // Memory usage
    const memoryUsage = process.memoryUsage();
    const memory = {
      used: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      total: Math.round(memoryUsage.heapTotal / 1024 / 1024),
      percentage: Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100),
    };
    
    // Determine overall status
    const status = dbOk && redisOk ? 'ok' : 'degraded';
    
    const response = {
      status,
      db: dbOk ? 'ok' : 'error',
      redis: redisOk ? 'ok' : 'error',
      bot: botStatus,
      queue: queueStatus,
      senders,
      memory,
    };
    
    const duration = Date.now() - startTime;
    logger.info({ status, duration }, 'Health check completed');
    
    return reply.status(status === 'ok' ? HTTP_STATUS.OK : HTTP_STATUS.OK).send(response);
  });
  
  // Bot health check endpoint (called by API to verify bot is running)
  fastify.get('/bot-health', async (_request: FastifyRequest, _reply: FastifyReply) => {
    return { status: 'ok', service: 'bot' };
  });
}