import type { Job } from 'bullmq';
import {
  getPrismaClient,
  getLogger,
} from '@mailguard/core';
import { getMailer } from '@mailguard/smtp';
import type { EmailJobData } from '@mailguard/core';

const logger = getLogger('worker:email');

/**
 * Email job processor
 * Handles sending emails via Nodemailer
 */
export async function processEmailJob(job: Job<EmailJobData>): Promise<void> {
  const data = job.data;
  const { senderEmailId, recipientEmail, subject, body, format, emailLogId } = data;
  
  logger.info({ jobId: job.id, recipientEmail: recipientEmail.substring(0, 3) + '***' }, 'Processing email job');
  
  const prisma = getPrismaClient();
  const encryptionKey = process.env.ENCRYPTION_KEY;
  
  if (!encryptionKey) {
    throw new Error('ENCRYPTION_KEY not set');
  }
  
  // Get sender email
  const sender = await prisma.senderEmail.findUnique({
    where: { id: senderEmailId },
  });
  
  if (!sender) {
    logger.error({ senderEmailId }, 'Sender email not found');
    await updateEmailLog(prisma, emailLogId, 'failed', null, 'Sender email not found');
    throw new Error('Sender email not found');
  }
  
  if (!sender.isActive) {
    logger.error({ senderEmailId }, 'Sender email is inactive');
    await updateEmailLog(prisma, emailLogId, 'failed', null, 'Sender email is inactive');
    throw new Error('Sender email is inactive');
  }
  
  try {
    // Send email
    const mailer = getMailer();
    const result = await mailer.sendEmail(
      {
        from: sender.emailAddress,
        fromName: sender.displayName ?? undefined,
        to: recipientEmail,
        subject,
        text: format === 'html' ? undefined : body,
        html: format === 'html' ? body : undefined,
      },
      {
        email: sender.emailAddress,
        appPasswordEnc: sender.appPasswordEnc,
        encryptionKey,
        smtpHost: sender.smtpHost,
        smtpPort: sender.smtpPort,
      }
    );
    
    if (result.success) {
      // Update email log
      await updateEmailLog(prisma, emailLogId, 'sent', result.messageId);
      
      // Update sender last used
      await prisma.senderEmail.update({
        where: { id: senderEmailId },
        data: { lastUsedAt: new Date() },
      });
      
      logger.info({ jobId: job.id, messageId: result.messageId }, 'Email sent successfully');
    } else {
      throw new Error(result.error ?? 'Failed to send email');
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ jobId: job.id, error: errorMessage }, 'Failed to send email');
    
    // Update email log with error
    await updateEmailLog(prisma, emailLogId, 'failed', null, errorMessage);
    
    // Throw to trigger retry
    throw error;
  }
}

/**
 * Update email log status
 */
async function updateEmailLog(
  prisma: ReturnType<typeof getPrismaClient>,
  emailLogId: string | undefined,
  status: 'sent' | 'failed',
  messageId?: string | null,
  error?: string
): Promise<void> {
  if (!emailLogId) return;
  
  await prisma.emailLog.update({
    where: { id: emailLogId },
    data: {
      status,
      smtpMessageId: messageId,
      errorMessage: error,
      sentAt: status === 'sent' ? new Date() : undefined,
    },
  });
}