import { createConversation } from '@grammyjs/conversations';
import type { Conversation } from '@grammyjs/conversations';
import type { Context } from 'grammy';
import { getPrismaClient, getLogger, isValidEmail, maskEmail } from '@mailguard/core';
import { ProviderDetector } from '@mailguard/smtp';
import { getMailer } from '@mailguard/smtp';
import { Queue } from 'bullmq';
import { getBullMQRedis, QUEUE_CONFIG, QUEUE_JOBS, encrypt, NOTIFICATION_TYPES } from '@mailguard/core';

const logger = getLogger('bot:wizards:addemail');

/**
 * Add Email wizard conversation
 * Two-step wizard: email address + app password
 */
export async function addEmailConversation(conversation: Conversation<Context>, ctx: Context): Promise<void> {
  const encryptionKey = process.env.ENCRYPTION_KEY!;
  
  // Step 1: Ask for email address
  await ctx.reply(
    `📧 *Step 1 of 2 — Your sender email address?*\n\n` +
    `Use a non-personal account dedicated to sending.\n` +
    `e.g. \`noreply@gmail.com\``,
    { parse_mode: 'Markdown' }
  );
  
  // Wait for email input
  const emailCtx = await conversation.waitFor(':text');
  const email = emailCtx.msg?.text?.trim().toLowerCase();
  
  if (!email || !isValidEmail(email)) {
    await ctx.reply('❌ Invalid email address. Please try again with `/addemail`.');
    return;
  }
  
  // Detect provider
  const detection = ProviderDetector.detectFromEmail(email);
  
  if (!detection.detected || !detection.config) {
    await ctx.reply(
      `❌ *Unknown Provider*\n\n` +
      `The email domain \`${detection.domain}\` is not a recognized provider.\n\n` +
      `Supported providers:\n` +
      `• Gmail (\`@gmail.com\`, \`@googlemail.com\`)\n` +
      `• Outlook (\`@outlook.com\`, \`@hotmail.com\`, \`@live.com\`)\n` +
      `• Zoho (\`@zoho.com\`)\n` +
      `• Yahoo (\`@yahoo.com\`, \`@ymail.com\`)`,
      { parse_mode: 'Markdown' }
    );
    return;
  }
  
  const providerConfig = detection.config;
  const providerName = ProviderDetector.getProviderDisplayName(providerConfig.provider);
  
  await ctx.reply(
    `✅ *${providerName} detected* — provider configured automatically.\n\n` +
    `📧 Email: \`${email}\`\n` +
    `📤 Daily Limit: ${providerConfig.dailyLimit} emails/day\n\n` +
    `*Step 2 of 2 — App Password?*\n\n` +
    `This is NOT your ${providerName} login password.\n` +
    `Get it from your account security settings.\n\n` +
    `⚠️ Encrypted before saving. Delete this message after sending.`,
    { parse_mode: 'Markdown' }
  );
  
  // Wait for app password
  const passwordCtx = await conversation.waitFor(':text');
  const appPassword = passwordCtx.msg?.text?.trim();
  
  if (!appPassword || appPassword.length < 10) {
    await ctx.reply('❌ Invalid app password. It should be at least 10 characters. Please try again with `/addemail`.');
    return;
  }
  
  // Verify credentials
  await ctx.reply('🔄 Verifying account...');
  
  const encryptedPassword = encrypt(appPassword, encryptionKey);
  const mailer = getMailer();
  
  const verifyResult = await mailer.verifyConnection(email, encryptedPassword, encryptionKey);
  
  if (!verifyResult.success) {
    await ctx.reply(
      `❌ *Login Failed*\n\n` +
      `Error: \`${verifyResult.error}\`\n\n` +
      `Please check your app password and try again with \`/addemail\`.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }
  
  // Save to database
  const prisma = getPrismaClient();
  
  try {
    const sender = await prisma.senderEmail.create({
      data: {
        emailAddress: email,
        displayName: null,
        provider: providerConfig.provider,
        smtpHost: providerConfig.smtpHost,
        smtpPort: providerConfig.smtpPort,
        appPasswordEnc: encryptedPassword,
        dailyLimit: providerConfig.dailyLimit,
        isVerified: true,
        isActive: true,
      },
    });
    
    logger.info({ senderId: sender.id, email: maskEmail(email) }, 'Sender email saved');
    
    // Send notification
    const redis = getBullMQRedis();
    const notificationQueue = new Queue(QUEUE_CONFIG.NOTIFICATION_QUEUE, { connection: redis });
    await notificationQueue.add(QUEUE_JOBS.SEND_TELEGRAM_NOTIFICATION, {
      type: NOTIFICATION_TYPES.API_KEY_CREATED,
      data: {
        prefix: 'sender',
        label: email,
        project: 'N/A',
        isTest: false,
      },
    });
    
    await ctx.reply(
      `✅ *Account Saved*\n\n` +
      `📧 Email: \`${email}\`\n` +
      `🏷 Provider: ${providerName}\n` +
      `📤 Daily Limit: ${providerConfig.dailyLimit} emails/day\n` +
      `🆔 Sender ID: \`${sender.id.substring(0, 8)}\`\n\n` +
      `Next: Create a project with \`/newproject\``,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '📁 Create Project', callback_data: 'newproject' },
              { text: '➕ Add Another', callback_data: 'addemail' },
            ],
            [
              { text: '✅ Done', callback_data: 'start' },
            ],
          ],
        },
      }
    );
  } catch (error) {
    logger.error({ error }, 'Failed to save sender email');
    await ctx.reply('❌ Failed to save sender email. Please try again.');
  }
}

/**
 * Create the addemail conversation
 */
export function createAddEmailConversation() {
  return createConversation(addEmailConversation, 'addemail');
}