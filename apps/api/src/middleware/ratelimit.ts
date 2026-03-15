import type { FastifyRequest, FastifyReply } from 'fastify';
import { 
  RateLimiter, 
  RateLimitKeys, 
  RateLimitTiers, 
  hashEmailForRateLimit,
  hashKeyForCache,
  HTTP_STATUS,
  ERROR_CODES,
  getLogger,
} from '@mailguard/core';
import type { RateLimitResult } from '@mailguard/core';
import { getRedisClient } from '@mailguard/core';

const logger = getLogger('api:ratelimit');

let rateLimiter: RateLimiter | null = null;

/**
 * Get or create the rate limiter instance
 */
async function getRateLimiter(): Promise<RateLimiter> {
  if (!rateLimiter) {
    const redis = await getRedisClient();
    rateLimiter = new RateLimiter(redis as unknown as import('@mailguard/core').RedisClient);
  }
  return rateLimiter;
}

/**
 * Check OTP send rate limits
 * - OTPs per email per hour
 * - OTP sends per IP per minute
 */
export async function checkOtpSendRateLimit(
  _request: FastifyRequest,
  projectId: string,
  email: string,
  ip: string
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const limiter = await getRateLimiter();
  
  // Check per-email rate limit
  const emailKey = RateLimitKeys.otpPerEmail(projectId, hashEmailForRateLimit(email));
  const emailResult: RateLimitResult = await limiter.checkAndIncrement({
    key: emailKey,
    limit: RateLimitTiers.OTP_PER_EMAIL.limit,
    windowSeconds: RateLimitTiers.OTP_PER_EMAIL.windowSeconds,
  });
  
  if (!emailResult.allowed) {
    logger.warn({ email: email.substring(0, 3) + '***', projectId }, 'OTP per-email rate limit exceeded');
    return { allowed: false, retryAfter: emailResult.retryAfter };
  }
  
  // Check per-IP rate limit
  const ipKey = RateLimitKeys.otpPerIp(ip);
  const ipResult: RateLimitResult = await limiter.checkAndIncrement({
    key: ipKey,
    limit: RateLimitTiers.OTP_PER_IP.limit,
    windowSeconds: RateLimitTiers.OTP_PER_IP.windowSeconds,
  });
  
  if (!ipResult.allowed) {
    logger.warn({ ip, projectId }, 'OTP per-IP rate limit exceeded');
    return { allowed: false, retryAfter: ipResult.retryAfter };
  }
  
  return { allowed: true };
}

/**
 * Check API key rate limit
 */
export async function checkApiKeyRateLimit(
  apiKey: string
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const limiter = await getRateLimiter();
  const keyHash = hashKeyForCache(apiKey);
  const key = RateLimitKeys.apiKeyPerMinute(keyHash);
  
  const result: RateLimitResult = await limiter.checkAndIncrement({
    key,
    limit: RateLimitTiers.API_KEY_PER_MINUTE.limit,
    windowSeconds: RateLimitTiers.API_KEY_PER_MINUTE.windowSeconds,
  });
  
  if (!result.allowed) {
    logger.warn({ keyHash: keyHash.substring(0, 8) }, 'API key rate limit exceeded');
    return { allowed: false, retryAfter: result.retryAfter };
  }
  
  return { allowed: true };
}

/**
 * Check email per-project rate limit
 */
export async function checkProjectEmailRateLimit(
  projectId: string
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const limiter = await getRateLimiter();
  const key = RateLimitKeys.emailPerProject(projectId);
  
  const result: RateLimitResult = await limiter.checkAndIncrement({
    key,
    limit: RateLimitTiers.EMAIL_PER_PROJECT.limit,
    windowSeconds: RateLimitTiers.EMAIL_PER_PROJECT.windowSeconds,
  });
  
  if (!result.allowed) {
    logger.warn({ projectId }, 'Project email rate limit exceeded');
    return { allowed: false, retryAfter: result.retryAfter };
  }
  
  return { allowed: true };
}

/**
 * Send rate limit exceeded response
 */
export async function sendRateLimitResponse(
  reply: FastifyReply,
  retryAfter: number
): Promise<void> {
  await reply
    .status(HTTP_STATUS.TOO_MANY_REQUESTS)
    .header('Retry-After', retryAfter)
    .send({
      error: ERROR_CODES.RATE_LIMIT_EXCEEDED,
      retry_after: retryAfter,
    });
}