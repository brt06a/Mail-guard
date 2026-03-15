import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  getPrismaClient,
} from '@mailguard/core';

// Validation schema
const getLogsSchema = z.object({
  project_slug: z.string().optional(),
  status: z.enum(['queued', 'sent', 'delivered', 'bounced', 'failed']).optional(),
  type: z.enum(['otp', 'transactional', 'template']).optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});

/**
 * GET /api/v1/logs
 * Query email logs with filters
 */
export async function registerLogsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/v1/logs', async (request: FastifyRequest, _reply: FastifyReply) => {
    const query = getLogsSchema.parse(request.query);
    const { apiKey } = request as FastifyRequest & { apiKey: any };
    
    const prisma = getPrismaClient();
    
    // Build where clause
    const where: any = {};
    
    // Filter by project (either from query or from API key)
    if (query.project_slug) {
      where.project = { slug: query.project_slug };
    } else {
      where.projectId = apiKey.projectId;
    }
    
    if (query.status) {
      where.status = query.status;
    }
    
    if (query.type) {
      where.type = query.type;
    }
    
    if (query.date_from || query.date_to) {
      where.createdAt = {};
      if (query.date_from) {
        where.createdAt.gte = new Date(query.date_from);
      }
      if (query.date_to) {
        where.createdAt.lte = new Date(query.date_to);
      }
    }
    
    // Query logs
    const [logs, total] = await Promise.all([
      prisma.emailLog.findMany({
        where,
        include: {
          project: {
            select: { name: true, slug: true },
          },
          senderEmail: {
            select: { emailAddress: true, provider: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: query.limit,
        skip: query.offset,
      }),
      prisma.emailLog.count({ where }),
    ]);
    
    // Mask sensitive data
    const maskedLogs = logs.map((log) => ({
      id: log.id,
      project: log.project,
      sender: {
        email: log.senderEmail.emailAddress.replace(/(.{1})[^@]*(@)/, '$1***$2'),
        provider: log.senderEmail.provider,
      },
      type: log.type,
      recipient_email: log.recipientEmail.replace(/(.{1})[^@]*(@)/, '$1***$2'),
      subject: log.subject,
      status: log.status,
      error_message: log.errorMessage,
      created_at: log.createdAt,
      sent_at: log.sentAt,
    }));
    
    return {
      items: maskedLogs,
      total,
      limit: query.limit,
      offset: query.offset,
      has_more: query.offset + logs.length < total,
    };
  });
}