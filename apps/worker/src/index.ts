import { Worker, Queue } from 'bullmq';
import {
  validateWorkerEnv,
  getPrismaClient,
  closePrismaClient,
  getBullMQRedis,
  closeBullMQRedis,
  getLogger,
  QUEUE_CONFIG,
  QUEUE_JOBS,
  OTP_CLEANUP_INTERVAL_MS,
} from '@mailguard/core';
import { closeMailer } from '@mailguard/smtp';
import { processEmailJob } from './processors/email';
import { processCleanupJob } from './processors/cleanup';
import { processNotificationJob } from './processors/notification';

const logger = getLogger('worker:server');

// Validate environment on startup
validateWorkerEnv();

// Workers
let emailWorker: Worker | null = null;
let cleanupWorker: Worker | null = null;
let notificationWorker: Worker | null = null;

// Queues
let cleanupQueue: Queue | null = null;

/**
 * Start the worker service
 */
async function start(): Promise<void> {
  try {
    logger.info('Starting MailGuard Worker...');
    
    // Initialize connections
    logger.info('Initializing database connection...');
    const prisma = getPrismaClient();
    await prisma.$connect();
    
    logger.info('Initializing Redis connection...');
    const redis = getBullMQRedis();
    
    // Create workers
    logger.info('Creating email worker...');
    emailWorker = new Worker(
      QUEUE_CONFIG.EMAIL_QUEUE,
      async (job) => {
        if (job.name === QUEUE_JOBS.SEND_EMAIL) {
          await processEmailJob(job);
        }
      },
      {
        connection: redis,
        concurrency: 5,
        limiter: {
          max: 10,
          duration: 1000, // 10 jobs per second
        },
        maxStalledCount: 3,
        stalledInterval: 30000,
      }
    );
    
    // Set up retry handling for email worker
    emailWorker.on('completed', (job) => {
      logger.info({ jobId: job.id }, 'Email job completed');
    });
    
    emailWorker.on('failed', async (job, err) => {
      if (!job) return;
      
      logger.error({ jobId: job.id, error: err.message }, 'Email job failed');
      
      // If this was the final retry, send notification
      if (job.attemptsMade >= QUEUE_CONFIG.MAX_RETRIES) {
        // Enqueue notification
        const notificationQueue = new Queue(QUEUE_CONFIG.NOTIFICATION_QUEUE, { connection: redis });
        await notificationQueue.add(QUEUE_JOBS.SEND_TELEGRAM_NOTIFICATION, {
          type: 'smtp_failure',
          data: {
            recipient: job.data.recipientEmail,
            project: job.data.projectId,
            error: err.message,
            attempts: job.attemptsMade,
          },
        });
      }
    });
    
    emailWorker.on('error', (err) => {
      logger.error({ error: err.message }, 'Email worker error');
    });
    
    // Create notification worker
    logger.info('Creating notification worker...');
    notificationWorker = new Worker(
      QUEUE_CONFIG.NOTIFICATION_QUEUE,
      async (job) => {
        if (job.name === QUEUE_JOBS.SEND_TELEGRAM_NOTIFICATION) {
          await processNotificationJob(job);
        }
      },
      {
        connection: redis,
        concurrency: 3,
      }
    );
    
    notificationWorker.on('completed', (job) => {
      logger.info({ jobId: job.id }, 'Notification job completed');
    });
    
    notificationWorker.on('failed', (job, err) => {
      logger.error({ jobId: job?.id, error: err.message }, 'Notification job failed');
    });
    
    // Create cleanup queue and schedule repeatable job
    logger.info('Setting up cleanup job...');
    cleanupQueue = new Queue(QUEUE_CONFIG.CLEANUP_QUEUE, { connection: redis });
    
    // Schedule cleanup every 15 minutes
    await cleanupQueue.add(
      QUEUE_JOBS.CLEANUP_OTP,
      { timestamp: Date.now() },
      {
        repeat: {
          every: OTP_CLEANUP_INTERVAL_MS,
        },
      }
    );
    
    // Create cleanup worker
    cleanupWorker = new Worker(
      QUEUE_CONFIG.CLEANUP_QUEUE,
      async (job) => {
        if (job.name === QUEUE_JOBS.CLEANUP_OTP) {
          return processCleanupJob(job);
        }
        return undefined;
      },
      {
        connection: redis,
        concurrency: 1,
      }
    );
    
    cleanupWorker.on('completed', (job) => {
      logger.info({ jobId: job.id, result: job.returnvalue }, 'Cleanup job completed');
    });
    
    cleanupWorker.on('failed', (job, err) => {
      logger.error({ jobId: job?.id, error: err.message }, 'Cleanup job failed');
    });
    
    logger.info('MailGuard Worker started successfully');
    
    // Handle graceful shutdown
    setupGracefulShutdown();
    
  } catch (error) {
    logger.error({ error }, 'Failed to start worker');
    process.exit(1);
  }
}

/**
 * Setup graceful shutdown handlers
 */
function setupGracefulShutdown(): void {
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, starting graceful shutdown...`);
    
    try {
      // Close workers
      if (emailWorker) {
        await emailWorker.close();
      }
      if (cleanupWorker) {
        await cleanupWorker.close();
      }
      if (notificationWorker) {
        await notificationWorker.close();
      }
      if (cleanupQueue) {
        await cleanupQueue.close();
      }
      
      // Close mailer
      await closeMailer();
      
      // Close database
      await closePrismaClient();
      
      // Close Redis
      await closeBullMQRedis();
      
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

// Start the worker
start();