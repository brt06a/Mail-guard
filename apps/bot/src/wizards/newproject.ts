import { createConversation } from '@grammyjs/conversations';
import type { Conversation } from '@grammyjs/conversations';
import type { Context } from 'grammy';
import { getPrismaClient, getLogger, generateSlug, isValidSlug, OTP_DEFAULTS } from '@mailguard/core';

const logger = getLogger('bot:wizards:newproject');

  // Remove unused interface now that we use Context directly
/**
 * New Project wizard conversation
 * Multi-step: name → slug → OTP length → expiry → max attempts → sender
 */
export async function newProjectConversation(conversation: Conversation<Context>, ctx: Context): Promise<void> {
  const prisma = getPrismaClient();
  
  // Check if there are any sender emails
  const senderCount = await prisma.senderEmail.count({ where: { isActive: true } });
  
  if (senderCount === 0) {
    await ctx.reply(
      '⚠️ *No Sender Emails*\n\n' +
      'You need to add at least one sender email before creating a project.\n\n' +
      'Use `/addemail` to add a sender.',
      { parse_mode: 'Markdown' }
    );
    return;
  }
  
  // Step 1: Project name
  await ctx.reply('📁 *Step 1 of 5 — Project name?*', { parse_mode: 'Markdown' });
  
  const nameCtx = await conversation.waitFor(':text');
  const name = nameCtx.msg?.text?.trim();
  
  if (!name || name.length < 2 || name.length > 100) {
    await ctx.reply('❌ Project name must be between 2 and 100 characters.');
    return;
  }
  
  // Step 2: Project slug
  const suggestedSlug = generateSlug(name);
  await ctx.reply(
    `🔗 *Step 2 of 5 — Project slug?*\n\n` +
    `Used in commands, lowercase, no spaces.\n` +
    `Suggested: \`${suggestedSlug}\``,
    { parse_mode: 'Markdown' }
  );
  
  const slugCtx = await conversation.waitFor(':text');
  let slug = slugCtx.msg?.text?.trim().toLowerCase();
  
  if (!slug) {
    slug = suggestedSlug;
  }
  
  if (!isValidSlug(slug)) {
    await ctx.reply(
      '❌ Invalid slug. Use lowercase letters, numbers, and hyphens only.\n' +
      'Example: `my-project`',
      { parse_mode: 'Markdown' }
    );
    return;
  }
  
  // Check if slug exists
  const existingProject = await prisma.project.findUnique({ where: { slug } });
  if (existingProject) {
    await ctx.reply(`❌ A project with slug \`${slug}\` already exists.`, { parse_mode: 'Markdown' });
    return;
  }
  
  // Step 3: OTP Length
  await ctx.reply(
    `🔢 *Step 3 of 5 — OTP length?*`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '4', callback_data: 'otp_length_4' },
            { text: '6', callback_data: 'otp_length_6' },
            { text: '8', callback_data: 'otp_length_8' },
          ],
        ],
      },
    }
  );
  
  const otpLengthCtx = await conversation.waitFor('callback_query');
  const otpLengthData = otpLengthCtx.callbackQuery?.data;
  
  let otpLength: number = OTP_DEFAULTS.LENGTH;
  if (otpLengthData === 'otp_length_4') otpLength = 4;
  else if (otpLengthData === 'otp_length_8') otpLength = 8;
  else if (otpLengthData === 'otp_length_6') otpLength = 6;
  
  await otpLengthCtx.answerCallbackQuery();
  
  // Step 4: OTP Expiry
  await ctx.reply(
    `⏱ *Step 4 of 5 — OTP expiry in seconds?*\n\n` +
    `Default: 600 (10 minutes)\n` +
    `Common values: 300 (5 min), 600 (10 min), 900 (15 min)`,
    { parse_mode: 'Markdown' }
  );
  
  const expiryCtx = await conversation.waitFor(':text');
  const expiryText = expiryCtx.msg?.text?.trim();
  let otpExpirySeconds: number = OTP_DEFAULTS.EXPIRY_SECONDS;
  
  if (expiryText) {
    const parsed = parseInt(expiryText, 10);
    if (!isNaN(parsed) && parsed >= 60 && parsed <= 3600) {
      otpExpirySeconds = parsed;
    }
  }
  
  // Step 5: Max attempts
  await ctx.reply(
    `🔐 *Step 5 of 5 — Max failed attempts before lockout?*\n\n` +
    `Default: ${OTP_DEFAULTS.MAX_ATTEMPTS}`,
    { parse_mode: 'Markdown' }
  );
  
  const attemptsCtx = await conversation.waitFor(':text');
  const attemptsText = attemptsCtx.msg?.text?.trim();
  let otpMaxAttempts: number = OTP_DEFAULTS.MAX_ATTEMPTS;
  
  if (attemptsText) {
    const parsed = parseInt(attemptsText, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 10) {
      otpMaxAttempts = parsed;
    }
  }
  
  // Get available senders
  const senders = await prisma.senderEmail.findMany({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  
  if (senders.length === 0) {
    await ctx.reply('❌ No active sender emails available. Add one with `/addemail` first.');
    return;
  }
  
  // Step 6: Select sender
  const senderButtons = senders.map((sender, index) => [
    { text: `${sender.emailAddress}`, callback_data: `sender_${index}` },
  ]);
  
  await ctx.reply(
    `📧 *Select a sender email for this project:*`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: senderButtons,
      },
    }
  );
  
  const senderCtx = await conversation.waitFor('callback_query');
  const senderData = senderCtx.callbackQuery?.data;
  
  const senderIndex = senderData ? parseInt(senderData.replace('sender_', ''), 10) : 0;
  const selectedSender = senders[senderIndex] ?? senders[0];
  
  if (!selectedSender) {
    await ctx.reply('❌ No sender found. Please add a sender email first.');
    return;
  }
  
  await senderCtx.answerCallbackQuery();
  
  // Create project
  try {
    const project = await prisma.project.create({
      data: {
        name,
        slug,
        senderEmailId: selectedSender.id,
        otpLength,
        otpExpirySeconds,
        otpMaxAttempts,
        otpFormat: 'text',
        rateLimitPerHour: 10,
        isActive: true,
      },
    });
    
    logger.info({ projectId: project.id, slug }, 'Project created');
    
    await ctx.reply(
      `✅ *Project Created*\n\n` +
      `📁 Name: ${name}\n` +
      `🔗 Slug: \`${slug}\`\n` +
      `📧 Sender: \`${selectedSender.emailAddress}\`\n` +
      `🔢 OTP: ${otpLength} digits\n` +
      `⏱ Expiry: ${otpExpirySeconds}s (${Math.ceil(otpExpirySeconds / 60)} min)\n` +
      `🔐 Max Attempts: ${otpMaxAttempts}\n\n` +
      `Next steps:\n` +
      `1. Set OTP template: \`/setotp ${slug}\`\n` +
      `2. Generate API key: \`/genkey ${slug} "Production"\``,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    logger.error({ error }, 'Failed to create project');
    await ctx.reply('❌ Failed to create project. Please try again.');
  }
}

/**
 * Create the newproject conversation
 */
export function createNewProjectConversation() {
  return createConversation(newProjectConversation, 'newproject');
}