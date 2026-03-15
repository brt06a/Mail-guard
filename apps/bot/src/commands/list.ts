import type { Context } from 'grammy';
import { getPrismaClient, maskEmail, formatDate } from '@mailguard/core';

const ITEMS_PER_PAGE = 5;

/**
 * /senders command - List all sender emails
 */
export async function handleSenders(ctx: Context, page: number = 0): Promise<void> {
  const prisma = getPrismaClient();
  
  const [senders, total] = await Promise.all([
    prisma.senderEmail.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
      skip: page * ITEMS_PER_PAGE,
      take: ITEMS_PER_PAGE,
      include: {
        _count: { select: { projects: true } },
      },
    }),
    prisma.senderEmail.count({ where: { isActive: true } }),
  ]);
  
  if (senders.length === 0) {
    await ctx.reply(
      '📭 *No Sender Emails*\n\n' +
      'Add one with `/addemail`',
      { parse_mode: 'Markdown' }
    );
    return;
  }
  
  let message = `📧 *Sender Emails* (${total})\n\n`;
  
  for (const sender of senders) {
    const status = sender.isVerified ? '✅' : '⚠️';
    const projectCount = sender._count?.projects ?? 0;
    
    message += `${status} \`${sender.emailAddress}\`\n`;
    message += `   Provider: ${sender.provider}\n`;
    message += `   Projects: ${projectCount}\n`;
    message += `   Last used: ${formatDate(sender.lastUsedAt)}\n\n`;
  }
  
  const keyboard: any[][] = [];
  const row: any[] = [];
  
  if (page > 0) {
    row.push({ text: '◀️ Previous', callback_data: `senders_${page - 1}` });
  }
  
  if ((page + 1) * ITEMS_PER_PAGE < total) {
    row.push({ text: 'Next ▶️', callback_data: `senders_${page + 1}` });
  }
  
  if (row.length > 0) {
    keyboard.push(row);
  }
  
  keyboard.push([{ text: '🏠 Main Menu', callback_data: 'start' }]);
  
  await ctx.reply(message, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard },
  });
}

/**
 * /projects command - List all projects
 */
export async function handleProjects(ctx: Context, page: number = 0): Promise<void> {
  const prisma = getPrismaClient();
  
  const [projects, total] = await Promise.all([
    prisma.project.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
      skip: page * ITEMS_PER_PAGE,
      take: ITEMS_PER_PAGE,
      include: { senderEmail: true },
    }),
    prisma.project.count({ where: { isActive: true } }),
  ]);
  
  if (projects.length === 0) {
    await ctx.reply(
      '📁 *No Projects*\n\n' +
      'Create one with `/newproject`',
      { parse_mode: 'Markdown' }
    );
    return;
  }
  
  let message = `📁 *Projects* (${total})\n\n`;
  
  for (const project of projects) {
    const status = project.isActive ? '✅' : '⚠️';
    
    message += `${status} *${project.name}*\n`;
    message += `   Slug: \`${project.slug}\`\n`;
    message += `   Sender: \`${maskEmail(project.senderEmail.emailAddress)}\`\n`;
    message += `   OTP: ${project.otpLength} digits, ${Math.ceil(project.otpExpirySeconds / 60)} min\n\n`;
  }
  
  const keyboard: any[][] = [];
  const row: any[] = [];
  
  if (page > 0) {
    row.push({ text: '◀️ Previous', callback_data: `projects_${page - 1}` });
  }
  
  if ((page + 1) * ITEMS_PER_PAGE < total) {
    row.push({ text: 'Next ▶️', callback_data: `projects_${page + 1}` });
  }
  
  if (row.length > 0) {
    keyboard.push(row);
  }
  
  keyboard.push([{ text: '🏠 Main Menu', callback_data: 'start' }]);
  
  await ctx.reply(message, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard },
  });
}

/**
 * /keys command - List API keys for a project
 */
export async function handleKeys(ctx: Context, slug: string, page: number = 0): Promise<void> {
  const prisma = getPrismaClient();
  
  const project = await prisma.project.findUnique({
    where: { slug },
  });
  
  if (!project) {
    await ctx.reply(`❌ Project \`${slug}\` not found.`, { parse_mode: 'Markdown' });
    return;
  }
  
  const [keys, total] = await Promise.all([
    prisma.apiKey.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: 'desc' },
      skip: page * ITEMS_PER_PAGE,
      take: ITEMS_PER_PAGE,
    }),
    prisma.apiKey.count({ where: { projectId: project.id } }),
  ]);
  
  if (keys.length === 0) {
    await ctx.reply(
      `🔑 *No API Keys for ${project.name}*\n\n` +
      `Generate one with \`/genkey ${slug} "Production"\``,
      { parse_mode: 'Markdown' }
    );
    return;
  }
  
  let message = `🔑 *API Keys for ${project.name}* (${total})\n\n`;
  
  for (const key of keys) {
    const status = key.isActive ? '✅' : '❌';
    const type = key.isSandbox ? '🧪 Test' : '🔵 Live';
    
    message += `${status} ${type} \`${key.keyPrefix}...\`\n`;
    message += `   Label: ${key.label || 'No label'}\n`;
    message += `   Last used: ${formatDate(key.lastUsedAt)}\n`;
    message += `   Created: ${formatDate(key.createdAt)}\n\n`;
  }
  
  const keyboard: any[][] = [];
  const row: any[] = [];
  
  if (page > 0) {
    row.push({ text: '◀️ Previous', callback_data: `keys_${slug}_${page - 1}` });
  }
  
  if ((page + 1) * ITEMS_PER_PAGE < total) {
    row.push({ text: 'Next ▶️', callback_data: `keys_${slug}_${page + 1}` });
  }
  
  if (row.length > 0) {
    keyboard.push(row);
  }
  
  keyboard.push([{ text: '🔑 Generate Key', callback_data: `genkey_${slug}` }]);
  keyboard.push([{ text: '🏠 Main Menu', callback_data: 'start' }]);
  
  await ctx.reply(message, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard },
  });
}