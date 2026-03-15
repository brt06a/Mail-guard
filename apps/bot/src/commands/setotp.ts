import type { Context } from 'grammy';
import { createConversation } from '@grammyjs/conversations';
import type { Conversation } from '@grammyjs/conversations';
import { getPrismaClient, renderTemplate, TEMPLATE_PLACEHOLDERS, DEFAULT_OTP_TEMPLATE } from '@mailguard/core';

/**
 * Set OTP template command
 */
export async function handleSetOtp(ctx: Context, slug: string): Promise<void> {
  const prisma = getPrismaClient();
  
  const project = await prisma.project.findUnique({
    where: { slug },
    include: { senderEmail: true },
  });
  
  if (!project) {
    await ctx.reply(`❌ Project \`${slug}\` not found.`, { parse_mode: 'Markdown' });
    return;
  }
  
  await ctx.reply(
    `📧 *Set OTP Template for ${project.name}*\n\n` +
    `*Step 1 of 3 — Email subject line?*\n\n` +
    `Available placeholders:\n` +
    `• ${TEMPLATE_PLACEHOLDERS.OTP_CODE} — The OTP code\n` +
    `• ${TEMPLATE_PLACEHOLDERS.APP_NAME} — Project name\n` +
    `\n` +
    `Current: \`${project.otpSubjectTmpl ?? DEFAULT_OTP_TEMPLATE.subject}\``,
    { parse_mode: 'Markdown' }
  );
}

/**
 * Set OTP template wizard
 */
export async function setOtpConversation(conversation: Conversation<Context>, ctx: Context): Promise<void> {
  const prisma = getPrismaClient();
  
  // Get slug from context
  const slug = ctx.match as string;
  
  if (!slug) {
    await ctx.reply('❌ Please provide a project slug: `/setotp my-project`', { parse_mode: 'Markdown' });
    return;
  }
  
  const project = await prisma.project.findUnique({ where: { slug } });
  
  if (!project) {
    await ctx.reply(`❌ Project \`${slug}\` not found.`, { parse_mode: 'Markdown' });
    return;
  }
  
  // Step 1: Subject
  await ctx.reply(
    `📧 *Set OTP Template — Step 1 of 3*\n\n` +
    `*Email subject line?*\n\n` +
    `Placeholders: ${TEMPLATE_PLACEHOLDERS.OTP_CODE}, ${TEMPLATE_PLACEHOLDERS.APP_NAME}`,
    { parse_mode: 'Markdown' }
  );
  
  const subjectCtx = await conversation.waitFor(':text');
  const subject = subjectCtx.msg?.text?.trim();
  
  if (!subject) {
    await ctx.reply('❌ Invalid subject.');
    return;
  }
  
  // Step 2: Body
  await ctx.reply(
    `📧 *Set OTP Template — Step 2 of 3*\n\n` +
    `*Email body?*\n\n` +
    `Write it exactly as you want users to see it.\n` +
    `Use ${TEMPLATE_PLACEHOLDERS.OTP_CODE} where the code should appear.\n\n` +
    `Placeholders:\n` +
    `• ${TEMPLATE_PLACEHOLDERS.OTP_CODE} — OTP code\n` +
    `• ${TEMPLATE_PLACEHOLDERS.APP_NAME} — Project name\n` +
    `• ${TEMPLATE_PLACEHOLDERS.EXPIRY_MINUTES} — Expiry in minutes\n` +
    `• ${TEMPLATE_PLACEHOLDERS.RECIPIENT_EMAIL} — Recipient email\n` +
    `• ${TEMPLATE_PLACEHOLDERS.PURPOSE} — Purpose`,
    { parse_mode: 'Markdown' }
  );
  
  const bodyCtx = await conversation.waitFor(':text');
  const body = bodyCtx.msg?.text;
  
  if (!body || !body.includes(TEMPLATE_PLACEHOLDERS.OTP_CODE)) {
    await ctx.reply(
      `❌ Body must contain ${TEMPLATE_PLACEHOLDERS.OTP_CODE} placeholder.\n` +
      `Please try again with \`/setotp ${slug}\``,
      { parse_mode: 'Markdown' }
    );
    return;
  }
  
  // Step 3: Format
  await ctx.reply(
    `📧 *Set OTP Template — Step 3 of 3*\n\n` +
    `*Format: Plain Text or HTML?*`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '📝 Plain Text', callback_data: 'format_text' },
            { text: '🌐 HTML', callback_data: 'format_html' },
          ],
        ],
      },
    }
  );
  
  const formatCtx = await conversation.waitFor('callback_query');
  const formatData = formatCtx.callbackQuery?.data;
  const format = formatData === 'format_html' ? 'html' : 'text';
  
  await formatCtx.answerCallbackQuery();
  
  // Preview
  const previewData = {
    otp_code: '483920',
    app_name: project.name,
    expiry_minutes: Math.ceil(project.otpExpirySeconds / 60),
    expiry_seconds: project.otpExpirySeconds,
    recipient_email: 'user@example.com',
    purpose: 'verification',
  };
  
  const previewSubject = renderTemplate(subject, previewData);
  const previewBody = renderTemplate(body, previewData);
  
  const separator = '─'.repeat(40);
  
  await ctx.reply(
    `👀 *Preview*\n\n` +
    `${separator}\n` +
    `Subject: ${previewSubject}\n` +
    `${separator}\n\n` +
    `${previewBody}\n\n` +
    `${separator}`,
    { parse_mode: 'Markdown' }
  );
  
  // Confirm
  await ctx.reply(
    `Save this template?`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Save Template', callback_data: 'save_template' },
            { text: '✏️ Edit Again', callback_data: 'edit_template' },
          ],
        ],
      },
    }
  );
  
  const confirmCtx = await conversation.waitFor('callback_query');
  const confirmData = confirmCtx.callbackQuery?.data;
  
  await confirmCtx.answerCallbackQuery();
  
  if (confirmData === 'save_template') {
    // Save to database
    await prisma.project.update({
      where: { id: project.id },
      data: {
        otpSubjectTmpl: subject,
        otpBodyTmpl: body,
        otpFormat: format,
      },
    });
    
    await ctx.reply(
      `✅ *Template Saved*\n\n` +
      `Project: ${project.name}\n` +
      `Format: ${format === 'html' ? 'HTML' : 'Plain Text'}\n\n` +
      `Next: Generate API key with \`/genkey ${slug} "Production"\``,
      { parse_mode: 'Markdown' }
    );
  } else {
    await ctx.reply('Cancelled. Run `/setotp ' + slug + '` to try again.');
  }
}

export function createSetOtpConversation() {
  return createConversation(setOtpConversation, 'setotp');
}