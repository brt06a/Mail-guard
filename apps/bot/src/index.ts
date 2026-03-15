import { Bot, session, type Context, type SessionFlavor } from 'grammy';
import { conversations, type ConversationFlavor } from '@grammyjs/conversations';
import { RedisAdapter } from '@grammyjs/storage-redis';
import {
  validateBotEnv,
  getPrismaClient,
  closePrismaClient,
  getBullMQRedis,
  closeBullMQRedis,
  getLogger,
} from '@mailguard/core';
import { adminGateMiddleware } from './middleware/auth';
import { handleStart } from './commands/start';
import { createAddEmailConversation } from './wizards/addemail';
import { createNewProjectConversation } from './wizards/newproject';
import { createSetOtpConversation } from './commands/setotp';
import { handleGenKey } from './commands/genkey';
import { handleSenders, handleProjects, handleKeys } from './commands/list';
import { handleLogs } from './commands/logs';
import { buildHelpMessage, buildSettingsMessage } from './notify/messages';

const logger = getLogger('bot:server');

// Validate environment on startup
const env = validateBotEnv();

// Define session type
interface SessionData {
  page?: number;
  currentSlug?: string;
}

type MyContext = Context & SessionFlavor<SessionData> & ConversationFlavor;

// Initial session value
// Return type is intentionally unannotated so TypeScript infers `{}` which is
// assignable to both SessionData (all optional) and ConversationSessionData (all optional).
function initialSession() {
  return {};
}

/**
 * Start the bot service
 */
async function start(): Promise<void> {
  try {
    logger.info('Starting MailGuard Bot...');
    
    // Initialize connections
    logger.info('Initializing database connection...');
    const prisma = getPrismaClient();
    await prisma.$connect();
    
    logger.info('Initializing Redis connection...');
    const redis = getBullMQRedis();
    
    // Create bot
    const bot = new Bot<MyContext>(env.TELEGRAM_BOT_TOKEN);
    
    // Apply admin gate middleware
    bot.use(adminGateMiddleware(env.TELEGRAM_ADMIN_UID));
    
    // Set up session with Redis storage
    bot.use(
      session({
        initial: initialSession,
        storage: new RedisAdapter({ instance: redis }),
      })
    );
    
    // Set up conversations
    bot.use(conversations());
    
    // Register conversations
    bot.use(createAddEmailConversation());
    bot.use(createNewProjectConversation());
    bot.use(createSetOtpConversation());
    
    // Register command handlers
    
    // /start
    bot.command('start', async (ctx) => {
      await handleStart(ctx);
    });
    
    // /addemail
    bot.command('addemail', async (ctx) => {
      await ctx.conversation.enter('addemail');
    });
    
    // /newproject
    bot.command('newproject', async (ctx) => {
      await ctx.conversation.enter('newproject');
    });
    
    // /setotp
    bot.command('setotp', async (ctx) => {
      const slug = ctx.match as string;
      if (!slug) {
        await ctx.reply('❌ Usage: `/setotp <slug>`', { parse_mode: 'Markdown' });
        return;
      }
      await ctx.conversation.enter('setotp');
    });
    
    // /genkey
    bot.command('genkey', async (ctx) => {
      await handleGenKey(ctx);
    });
    
    // /senders
    bot.command('senders', async (ctx) => {
      await handleSenders(ctx);
    });
    
    // /projects
    bot.command('projects', async (ctx) => {
      await handleProjects(ctx);
    });
    
    // /keys
    bot.command('keys', async (ctx) => {
      const slug = ctx.match as string;
      if (!slug) {
        await ctx.reply('❌ Usage: `/keys <slug>`', { parse_mode: 'Markdown' });
        return;
      }
      await handleKeys(ctx, slug);
    });
    
    // /logs
    bot.command('logs', async (ctx) => {
      await handleLogs(ctx);
    });
    
    // /help
    bot.command('help', async (ctx) => {
      await ctx.reply(buildHelpMessage(), { parse_mode: 'Markdown' });
    });
    
    // /health
    bot.command('health', async (ctx) => {
      const dbOk = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
      const redisOk = await redis.ping().then(() => true).catch(() => false);
      
      await ctx.reply(
        `🏥 *Health Check*\n\n` +
        `Database: ${dbOk ? '✅ OK' : '❌ Error'}\n` +
        `Redis: ${redisOk ? '✅ OK' : '❌ Error'}\n` +
        `Bot: ✅ Online`,
        { parse_mode: 'Markdown' }
      );
    });
    
    // /settings
    bot.command('settings', async (ctx) => {
      await ctx.reply(
        buildSettingsMessage({
          notificationEnabled: true,
          dailySummaryEnabled: true,
          dailySummaryTime: '08:00',
        }),
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📢 Toggle Notifications', callback_data: 'toggle_notifications' }],
              [{ text: '📊 Toggle Daily Summary', callback_data: 'toggle_summary' }],
              [{ text: '🏠 Main Menu', callback_data: 'start' }],
            ],
          },
        }
      );
    });
    
    // Callback query handlers
    bot.callbackQuery('start', async (ctx) => {
      await ctx.answerCallbackQuery();
      await handleStart(ctx);
    });
    
    bot.callbackQuery('addemail', async (ctx) => {
      await ctx.answerCallbackQuery();
      await ctx.conversation.enter('addemail');
    });
    
    bot.callbackQuery('newproject', async (ctx) => {
      await ctx.answerCallbackQuery();
      await ctx.conversation.enter('newproject');
    });
    
    bot.callbackQuery('projects', async (ctx) => {
      await ctx.answerCallbackQuery();
      await handleProjects(ctx);
    });
    
    bot.callbackQuery('logs', async (ctx) => {
      await ctx.answerCallbackQuery();
      await handleLogs(ctx);
    });
    
    bot.callbackQuery('genkey', async (ctx) => {
      await ctx.answerCallbackQuery();
      await ctx.reply('Usage: `/genkey <slug> <label> [--test]`', { parse_mode: 'Markdown' });
    });
    
    bot.callbackQuery('help', async (ctx) => {
      await ctx.answerCallbackQuery();
      await ctx.reply(buildHelpMessage(), { parse_mode: 'Markdown' });
    });
    
    bot.callbackQuery('settings', async (ctx) => {
      await ctx.answerCallbackQuery();
      await ctx.reply(
        buildSettingsMessage({
          notificationEnabled: true,
          dailySummaryEnabled: true,
          dailySummaryTime: '08:00',
        }),
        { parse_mode: 'Markdown' }
      );
    });
    
    // Pagination callbacks
    bot.callbackQuery(/senders_(\d+)/, async (ctx) => {
      const page = parseInt(ctx.match?.[1] ?? '0', 10);
      await ctx.answerCallbackQuery();
      await handleSenders(ctx, page);
    });
    
    bot.callbackQuery(/projects_(\d+)/, async (ctx) => {
      const page = parseInt(ctx.match?.[1] ?? '0', 10);
      await ctx.answerCallbackQuery();
      await handleProjects(ctx, page);
    });
    
    bot.callbackQuery(/keys_(\d+)/, async (ctx) => {
      const page = parseInt(ctx.match?.[1] ?? '0', 10);
      await ctx.answerCallbackQuery();
      await handleKeys(ctx, '', page);
    });
    
    bot.callbackQuery(/logs_(\d+)/, async (ctx) => {
      const page = parseInt(ctx.match?.[1] ?? '0', 10);
      await ctx.answerCallbackQuery();
      await handleLogs(ctx, page);
    });
    
    // Start bot
    await bot.start({
      onStart: () => {
        logger.info('MailGuard Bot started successfully');
      },
    });
    
    // Handle graceful shutdown
    setupGracefulShutdown(bot);
    
  } catch (error) {
    logger.error({ error }, 'Failed to start bot');
    process.exit(1);
  }
}

/**
 * Setup graceful shutdown handlers
 */
function setupGracefulShutdown(bot: Bot<MyContext>): void {
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, starting graceful shutdown...`);
    
    try {
      // Stop bot
      await bot.stop();
      
      // Close database
      await closePrismaClient();
      
      // Close Redis
      await closeBullMQRedis();
      
      logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error({ error }, 'Error during shutdown');
      process.exit(1);
    }
  };
  
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  
  // Handle unhandled rejections
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled rejection');
  });
  
  process.on('uncaughtException', (error) => {
    logger.error({ error: error.message, stack: error.stack }, 'Uncaught exception');
    process.exit(1);
  });
}

// Start the bot
start();