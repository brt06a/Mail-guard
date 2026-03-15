import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  getPrismaClient,
  generateOtp,
  hashOtp,
  calculateExpiryDate,
  maskEmail,
  renderOtpSubject,
  renderOtpBody,
  HTTP_STATUS,
  ERROR_CODES,
  QUEUE_CONFIG,
  QUEUE_JOBS,
  getLogger,
} from '@mailguard/core';
import type { SendOtpRequest, SendOtpResponse, VerifyOtpRequest } from '@mailguard/core';
import { checkOtpSendRateLimit, sendRateLimitResponse, checkProjectEmailRateLimit } from '../middleware/ratelimit';
import { getRequestIp } from '../utils/request';
import { Queue } from 'bullmq';
import { getBullMQRedis } from '@mailguard/core';

const logger = getLogger('api:routes:otp');

// Validation schemas
const sendOtpSchema = z.object({
  email: z.string().email('Invalid email address'),
  purpose: z.string().max(50).optional().default('verification'),
});

const verifyOtpSchema = z.object({
  email: z.string().email('Invalid email address'),
  code: z.string().length(6, 'OTP code must be 6 digits').or(z.string().length(4)).or(z.string().length(8)),
});

let emailQueue: Queue | null = null;

async function getEmailQueue(): Promise<Queue> {
  if (!emailQueue) {
    const redis = getBullMQRedis();
    emailQueue = new Queue(QUEUE_CONFIG.EMAIL_QUEUE, {
      connection: redis,
    });
  }
  return emailQueue;
}

/**
 * POST /api/v1/otp/send
 * Generate and send an OTP to an email address
 */
export async function registerOtpRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /api/v1/otp/send
  fastify.post('/api/v1/otp/send', async (request: FastifyRequest, reply: FastifyReply) => {
    // Validate request body
    const bodyResult = sendOtpSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(HTTP_STATUS.UNPROCESSABLE_ENTITY).send({
        error: ERROR_CODES.INVALID_EMAIL,
        message: bodyResult.error.issues[0]?.message ?? 'Invalid request',
      });
    }
    
    const body = bodyResult.data as SendOtpRequest;
    const { apiKey, isSandbox } = request as FastifyRequest & { apiKey: any; isSandbox: boolean };
    
    const projectId = apiKey.projectId;
    const project = apiKey.project;
    const ip = getRequestIp(request);
    
    // Check rate limits
    const rateLimitResult = await checkOtpSendRateLimit(request, projectId, body.email, ip);
    if (!rateLimitResult.allowed) {
      return sendRateLimitResponse(reply, rateLimitResult.retryAfter!);
    }
    
    // Check project email rate limit
    const projectRateLimit = await checkProjectEmailRateLimit(projectId);
    if (!projectRateLimit.allowed) {
      return sendRateLimitResponse(reply, projectRateLimit.retryAfter!);
    }
    
    // Sandbox mode: return mock response
    if (isSandbox) {
      logger.info({ email: maskEmail(body.email), projectId, sandbox: true }, 'Sandbox OTP send');
      return {
        id: 'sandbox-otp-id',
        status: 'sent',
        expires_in: project.otpExpirySeconds,
        masked_email: maskEmail(body.email),
      } as SendOtpResponse;
    }
    
    const prisma = getPrismaClient();
    
    // Generate OTP
    const otpCode = generateOtp(project.otpLength);
    const otpHash = await hashOtp(otpCode);
    const expiresAt = calculateExpiryDate(project.otpExpirySeconds);
    
    // Invalidate any existing active OTPs for this email+project
    await prisma.otpRecord.updateMany({
      where: {
        projectId,
        recipientEmail: body.email.toLowerCase(),
        isVerified: false,
        isInvalidated: false,
        expiresAt: { gt: new Date() },
      },
      data: {
        isInvalidated: true,
      },
    });
    
    // Create new OTP record
    const otpRecord = await prisma.otpRecord.create({
      data: {
        projectId,
        recipientEmail: body.email.toLowerCase(),
        otpHash,
        purpose: body.purpose ?? 'verification',
        expiresAt,
        ipAddress: ip,
      },
    });
    
    // Render email template
    const templateData = {
      otp_code: otpCode,
      app_name: project.name,
      expiry_minutes: Math.ceil(project.otpExpirySeconds / 60),
      expiry_seconds: project.otpExpirySeconds,
      recipient_email: body.email,
      purpose: body.purpose ?? 'verification',
    };
    
    const subject = renderOtpSubject(project.otpSubjectTmpl, templateData);
    const emailBody = renderOtpBody(project.otpBodyTmpl, templateData);
    
    // Create email log
    const emailLog = await prisma.emailLog.create({
      data: {
        projectId,
        senderEmailId: project.senderEmailId,
        type: 'otp',
        recipientEmail: body.email.toLowerCase(),
        subject,
        status: 'queued',
      },
    });
    
    // Enqueue email job
    const queue = await getEmailQueue();
    await queue.add(QUEUE_JOBS.SEND_EMAIL, {
      otpRecordId: otpRecord.id,
      senderEmailId: project.senderEmailId,
      recipientEmail: body.email.toLowerCase(),
      subject,
      body: emailBody,
      format: project.otpFormat,
      projectId,
      emailLogId: emailLog.id,
    });
    
    logger.info({ 
      otpId: otpRecord.id, 
      email: maskEmail(body.email), 
      projectId 
    }, 'OTP created and email queued');
    
    return {
      id: otpRecord.id,
      status: 'sent',
      expires_in: project.otpExpirySeconds,
      masked_email: maskEmail(body.email),
    } as SendOtpResponse;
  });
  
  // POST /api/v1/otp/verify
  fastify.post('/api/v1/otp/verify', async (request: FastifyRequest, reply: FastifyReply) => {
    // Validate request body
    const bodyResult = verifyOtpSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(HTTP_STATUS.BAD_REQUEST).send({
        verified: false,
        error: ERROR_CODES.INVALID_CODE,
        message: bodyResult.error.issues[0]?.message ?? 'Invalid request',
      });
    }
    
    const body = bodyResult.data as VerifyOtpRequest;
    const { apiKey, isSandbox } = request as FastifyRequest & { apiKey: any; isSandbox: boolean };
    
    const projectId = apiKey.projectId;
    const project = apiKey.project;
    
    // Sandbox mode: accept only "000000"
    if (isSandbox) {
      if (body.code === '000000') {
        return {
          verified: true,
          token: 'sandbox-token',
          expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        };
      }
      return {
        verified: false,
        error: ERROR_CODES.INVALID_CODE,
        attempts_remaining: 5,
      };
    }
    
    const prisma = getPrismaClient();
    
    // Find active OTP record
    const otpRecord = await prisma.otpRecord.findFirst({
      where: {
        projectId,
        recipientEmail: body.email.toLowerCase(),
        isVerified: false,
        isInvalidated: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
    
    // No active OTP found
    if (!otpRecord) {
      // Check if there's an expired record
      const expiredRecord = await prisma.otpRecord.findFirst({
        where: {
          projectId,
          recipientEmail: body.email.toLowerCase(),
          isVerified: false,
          isInvalidated: false,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });
      
      if (expiredRecord && expiredRecord.expiresAt < new Date()) {
        return reply.status(HTTP_STATUS.GONE).send({
          verified: false,
          error: ERROR_CODES.OTP_EXPIRED,
        });
      }
      
      return reply.status(HTTP_STATUS.GONE).send({
        verified: false,
        error: ERROR_CODES.OTP_EXPIRED,
      });
    }
    
    // Check if locked
    if (otpRecord.attemptsCount >= project.otpMaxAttempts) {
      return reply.status(HTTP_STATUS.LOCKED).send({
        verified: false,
        error: ERROR_CODES.ACCOUNT_LOCKED,
      });
    }
    
    // Import bcrypt for verification
    const bcrypt = await import('bcrypt');
    const isValid = await bcrypt.compare(body.code, otpRecord.otpHash);
    
    if (isValid) {
      // Mark as verified and invalidated
      await prisma.otpRecord.update({
        where: { id: otpRecord.id },
        data: {
          isVerified: true,
          isInvalidated: true,
          verifiedAt: new Date(),
        },
      });
      
      // Generate JWT token
      const { signOtpToken } = await import('@mailguard/core');
      const token = signOtpToken({
        sub: otpRecord.recipientEmail,
        projectId,
        purpose: otpRecord.purpose,
        otpRecordId: otpRecord.id,
      }, process.env.JWT_SECRET!);
      
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
      
      logger.info({ 
        otpId: otpRecord.id, 
        email: maskEmail(body.email), 
        projectId 
      }, 'OTP verified successfully');
      
      return {
        verified: true,
        token,
        expires_at: expiresAt.toISOString(),
      };
    }
    
    // Invalid code - increment attempts
    const newAttempts = otpRecord.attemptsCount + 1;
    await prisma.otpRecord.update({
      where: { id: otpRecord.id },
      data: { attemptsCount: newAttempts },
    });
    
    logger.warn({ 
      otpId: otpRecord.id, 
      email: maskEmail(body.email), 
      projectId,
      attempts: newAttempts 
    }, 'OTP verification failed');
    
    // Check if now locked
    if (newAttempts >= project.otpMaxAttempts) {
      return reply.status(HTTP_STATUS.LOCKED).send({
        verified: false,
        error: ERROR_CODES.ACCOUNT_LOCKED,
      });
    }
    
    return {
      verified: false,
      error: ERROR_CODES.INVALID_CODE,
      attempts_remaining: project.otpMaxAttempts - newAttempts,
    };
  });
}