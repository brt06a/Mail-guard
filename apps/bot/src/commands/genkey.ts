import type { Context } from 'grammy';
import { getPrismaClient, getLogger, generateApiKey, QUEUE_CONFIG, QUEUE_JOBS, NOTIFICATION_TYPES, getBullMQRedis } from '@mailguard/core';
import { Queue } from 'bullmq';

const logger = getLogger('bot:commands:genkey');

/**
 * /genkey command handler
 * Generate an API key for a project
 * 
 * Usage: /genkey <slug> <label> [--test]
 */
export async function handleGenKey(ctx: Context): Promise<void> {
  const text = ctx.msg?.text ?? '';
  const args = text.split(/\s+/).slice(1);
  
  if (args.length < 2) {
    await ctx.reply(
      '❌ *Usage:*\n\n' +
      '`/genkey <slug> <label> [--test]`\n\n' +
      'Example:\n' +
      '`/genkey my-app "Production Key"`\n' +
      '`/genkey my-app "Test Key" --test`',
      { parse_mode: 'Markdown' }
    );
    return;
  }
  
  const slug = args[0];
  const isTest = args.includes('--test');
  const label = args.slice(1).filter(a => a !== '--test').join(' ').replace(/^["']|["']$/g, '');
  
  if (!slug) {
    await ctx.reply('❌ Please provide a project slug.');
    return;
  }
  
  const prisma = getPrismaClient();
  
  // Find project
  const project = await prisma.project.findUnique({
    where: { slug },
    include: { senderEmail: true },
  });
  
  if (!project) {
    await ctx.reply(`❌ Project \`${slug}\` not found.`, { parse_mode: 'Markdown' });
    return;
  }
  
  if (!project.isActive) {
    await ctx.reply(`❌ Project \`${slug}\` is inactive.`, { parse_mode: 'Markdown' });
    return;
  }
  
  // Generate API key
  const { fullKey, keyHash, keyPrefix } = generateApiKey(isTest);
  
  // Save to database
  const apiKey = await prisma.apiKey.create({
    data: {
      projectId: project.id,
      keyHash,
      keyPrefix,
      label: label || null,
      isSandbox: isTest,
      isActive: true,
    },
  });
  
  logger.info({ apiKeyId: apiKey.id, projectId: project.id, isTest }, 'API key generated');
  
  // Send notification
  try {
    const redis = getBullMQRedis();
    const notificationQueue = new Queue(QUEUE_CONFIG.NOTIFICATION_QUEUE, { connection: redis });
    await notificationQueue.add(QUEUE_JOBS.SEND_TELEGRAM_NOTIFICATION, {
      type: NOTIFICATION_TYPES.API_KEY_CREATED,
      data: {
        prefix: keyPrefix,
        label: label || 'No label',
        project: project.name,
        isTest,
      },
    });
  } catch (error) {
    logger.warn({ error }, 'Failed to send notification');
  }
  
  // Show key to user (shown once only)
  await ctx.reply(
    `🔑 *API Key Generated*\n\n` +
    `📁 Project: ${project.name}\n` +
    `🏷 Label: ${label || 'No label'}\n` +
    `🔤 Prefix: \`${keyPrefix}\`\n` +
    `${isTest ? '🧪 Sandbox Mode (OTP: 000000)\n' : ''}\n` +
    `*Full key — copy now, shown once only:*\n` +
    `\`${fullKey}\`\n\n` +
    `⚠️ Store this in your app's environment variables.\n` +
    `It cannot be retrieved again.`,
    { parse_mode: 'Markdown' }
  );
  
  // Warn about deleting the message
  await ctx.reply(
    '⚠️ *Security Notice*\n\n' +
    'Delete the message above after copying the key.\n' +
    'This is the only time the full key will be shown.',
    { parse_mode: 'Markdown' }
  );
}