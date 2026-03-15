import type { Context } from 'grammy';
import { getPrismaClient, maskEmail, formatDate } from '@mailguard/core';

const ITEMS_PER_PAGE = 10;

/**
 * /logs command - View email logs
 * 
 * Usage: /logs [slug] [--failed] [--today]
 */
export async function handleLogs(ctx: Context, page: number = 0): Promise<void> {
  const text = ctx.msg?.text ?? '';
  const args = text.split(/\s+/).slice(1);
  
  const showFailed = args.includes('--failed');
  const showToday = args.includes('--today');
  const slugArg = args.find(a => !a.startsWith('--'));
  
  const prisma = getPrismaClient();
  
  // Build where clause
  const where: any = {};
  
  if (slugArg) {
    const project = await prisma.project.findUnique({ where: { slug: slugArg } });
    if (!project) {
      await ctx.reply(`❌ Project \`${slugArg}\` not found.`, { parse_mode: 'Markdown' });
      return;
    }
    where.projectId = project.id;
  }
  
  if (showFailed) {
    where.status = 'failed';
  }
  
  if (showToday) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    where.createdAt = { gte: today };
  }
  
  const [logs, total] = await Promise.all([
    prisma.emailLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: page * ITEMS_PER_PAGE,
      take: ITEMS_PER_PAGE,
      include: {
        project: { select: { name: true, slug: true } },
        senderEmail: { select: { emailAddress: true } },
      },
    }),
    prisma.emailLog.count({ where }),
  ]);
  
  if (logs.length === 0) {
    await ctx.reply(
      '📭 *No Logs Found*\n\n' +
      'No email logs match your filters.',
      { parse_mode: 'Markdown' }
    );
    return;
  }
  
  let message = `📊 *Email Logs* (${total})\n`;
  
  if (showFailed) message += `Filter: Failed only\n`;
  if (showToday) message += `Filter: Today\n`;
  if (slugArg) message += `Project: ${slugArg}\n`;
  
  message += '\n';
  
  const statusEmoji: Record<string, string> = {
    queued: '⏳',
    sent: '✅',
    delivered: '✅',
    bounced: '⚠️',
    failed: '❌',
  };
  
  for (const log of logs) {
    const emoji = statusEmoji[log.status] ?? '❓';
    
    message += `${emoji} \`${maskEmail(log.recipientEmail)}\`\n`;
    message += `   Project: ${log.project?.name ?? 'Unknown'}\n`;
    message += `   Status: ${log.status}\n`;
    message += `   Time: ${formatDate(log.createdAt)}\n`;
    
    if (log.errorMessage) {
      message += `   Error: ${log.errorMessage.substring(0, 50)}...\n`;
    }
    
    message += '\n';
  }
  
  const keyboard: any[][] = [];
  const row: any[] = [];
  
  if (page > 0) {
    row.push({ text: '◀️ Previous', callback_data: `logs_${page - 1}` });
  }
  
  if ((page + 1) * ITEMS_PER_PAGE < total) {
    row.push({ text: 'Next ▶️', callback_data: `logs_${page + 1}` });
  }
  
  if (row.length > 0) {
    keyboard.push(row);
  }
  
  keyboard.push([
    { text: '❌ Failed Only', callback_data: 'logs_failed' },
    { text: '📅 Today', callback_data: 'logs_today' },
  ]);
  keyboard.push([{ text: '🏠 Main Menu', callback_data: 'start' }]);
  
  await ctx.reply(message, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard },
  });
}