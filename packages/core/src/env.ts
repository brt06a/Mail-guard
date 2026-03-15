import { z } from 'zod';

const encryptionKeySchema = z.string().refine(
  (val) => {
    try {
      const trimmed = val.trim();
      return /^[0-9a-fA-F]+$/.test(trimmed) && Buffer.from(trimmed, "hex").length === 32;
    } catch {
      return false;
    }
  },
  "ENCRYPTION_KEY must represent a 32-byte hex key"
);

/**
 * Environment variable schema with validation
 */
const envSchema = z.object({
  // Telegram Bot Configuration
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  TELEGRAM_ADMIN_UID: z.string().min(1, 'TELEGRAM_ADMIN_UID is required').transform((val) => {
    const parsed = parseInt(val, 10);
    if (isNaN(parsed)) {
      throw new Error('TELEGRAM_ADMIN_UID must be a valid integer');
    }
    return parsed;
  }),

  // Database
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),

  // Redis
  REDIS_URL: z.string().url('REDIS_URL must be a valid URL'),

  // Security
  JWT_SECRET: z.string().min(64, 'JWT_SECRET must be at least 64 characters'),
  ENCRYPTION_KEY: encryptionKeySchema,

  // Application
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().optional().default('3000').transform((val) => {
    const parsed = parseInt(val, 10);
    if (isNaN(parsed) || parsed < 1 || parsed > 65535) {
      throw new Error('PORT must be a valid port number (1-65535)');
    }
    return parsed;
  }),

  // Bot Service Only
  INTERNAL_API_URL: z.string().url('INTERNAL_API_URL must be a valid URL').optional(),
});

/**
 * Schema for worker service (subset of variables)
 */
const workerEnvSchema = z.object({
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),
  REDIS_URL: z.string().url('REDIS_URL must be a valid URL'),
  ENCRYPTION_KEY: encryptionKeySchema,
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  TELEGRAM_ADMIN_UID: z.string().min(1, 'TELEGRAM_ADMIN_UID is required').transform((val) => {
    const parsed = parseInt(val, 10);
    if (isNaN(parsed)) {
      throw new Error('TELEGRAM_ADMIN_UID must be a valid integer');
    }
    return parsed;
  }),
});

/**
 * Schema for bot service (subset of variables)
 */
const botEnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  TELEGRAM_ADMIN_UID: z.string().min(1, 'TELEGRAM_ADMIN_UID is required').transform((val) => {
    const parsed = parseInt(val, 10);
    if (isNaN(parsed)) {
      throw new Error('TELEGRAM_ADMIN_UID must be a valid integer');
    }
    return parsed;
  }),
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),
  REDIS_URL: z.string().url('REDIS_URL must be a valid URL'),
  ENCRYPTION_KEY: encryptionKeySchema,
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  INTERNAL_API_URL: z.string().url('INTERNAL_API_URL must be a valid URL'),
});

export type EnvConfig = z.infer<typeof envSchema>;
export type WorkerEnvConfig = z.infer<typeof workerEnvSchema>;
export type BotEnvConfig = z.infer<typeof botEnvSchema>;

/**
 * Validates and parses environment variables for API service
 */
export function validateEnv(env: Record<string, string | undefined> = process.env): EnvConfig {
  const result = envSchema.safeParse(env);
  
  if (!result.success) {
    const errors = result.error.issues.map((issue) => {
      const path = issue.path.join('.');
      return `  - ${path}: ${issue.message}`;
    }).join('\n');
    
    throw new Error(`Environment validation failed:\n${errors}`);
  }
  
  return result.data;
}

/**
 * Validates and parses environment variables for Worker service
 */
export function validateWorkerEnv(env: Record<string, string | undefined> = process.env): WorkerEnvConfig {
  const result = workerEnvSchema.safeParse(env);
  
  if (!result.success) {
    const errors = result.error.issues.map((issue) => {
      const path = issue.path.join('.');
      return `  - ${path}: ${issue.message}`;
    }).join('\n');
    
    throw new Error(`Environment validation failed:\n${errors}`);
  }
  
  return result.data;
}

/**
 * Validates and parses environment variables for Bot service
 */
export function validateBotEnv(env: Record<string, string | undefined> = process.env): BotEnvConfig {
  const result = botEnvSchema.safeParse(env);
  
  if (!result.success) {
    const errors = result.error.issues.map((issue) => {
      const path = issue.path.join('.');
      return `  - ${path}: ${issue.message}`;
    }).join('\n');
    
    throw new Error(`Environment validation failed:\n${errors}`);
  }
  
  return result.data;
}