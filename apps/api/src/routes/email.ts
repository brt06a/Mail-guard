import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  getPrismaClient,
  HTTP_STATUS,
  QUEUE_CONFIG,
  QUEUE_JOBS,
  getLogger,
  getBullMQRedis,
} from '@mailguard/core';
import { checkProjectEmailRateLimit, sendRateLimitResponse } from '../middleware/ratelimit';

const logger = getLogger('api:routes:email');

// Validation schema
const sendEmailSchema = z.object({
  to: z.string().email('Invalid recipient email'),
  subject: z.string().min(1).max(500),
  body: z.string().min(1),
  format: z.enum(['text', 'html']).optional().default('text'),
  template_id: z.string().optional(),
  variables: z.record(z.unknown()).optional(),
});

/**
 * POST /api/v1/email/send
 * Send a transactional email
 */
export async function registerEmailRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/api/v1/email/send', async (request: FastifyRequest, reply: FastifyReply) => {
    // Validate request body
    const bodyResult = sendEmailSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(HTTP_STATUS.BAD_REQUEST).send({
        error: 'invalid_request',
        message: bodyResult.error.issues[0]?.message ?? 'Invalid request',
      });
    }
    
    const body = bodyResult.data;
    const { apiKey } = request as FastifyRequest & { apiKey: any };
    
    const projectId = apiKey.projectId;
    const project = apiKey.project;
    
    // Check project email rate limit
    const rateLimitResult = await checkProjectEmailRateLimit(projectId);
    if (!rateLimitResult.allowed) {
      return sendRateLimitResponse(reply, rateLimitResult.retryAfter!);
    }
    
    const prisma = getPrismaClient();
    
    // Create email log
    const emailLog = await prisma.emailLog.create({
      data: {
        projectId,
        senderEmailId: project.senderEmailId,
        type: 'transactional',
        recipientEmail: body.to.toLowerCase(),
        subject: body.subject,
        status: 'queued',
      },
    });
    
    // Enqueue email job
    const { Queue } = await import('bullmq');
    const redis = getBullMQRedis();
    const queue = new Queue(QUEUE_CONFIG.EMAIL_QUEUE, { connection: redis });
    
    await queue.add(QUEUE_JOBS.SEND_EMAIL, {
      senderEmailId: project.senderEmailId,
      recipientEmail: body.to.toLowerCase(),
      subject: body.subject,
      body: body.body,
      format: body.format,
      projectId,
      emailLogId: emailLog.id,
    });
    
    logger.info({ 
      emailLogId: emailLog.id, 
      to: body.to.substring(0, 3) + '***', 
      projectId 
    }, 'Transactional email queued');
    
    return {
      id: emailLog.id,
      status: 'queued',
    };
  });
}