import type { FastifyRequest, FastifyReply } from 'fastify';
import { isProduction, HTTP_STATUS, getLogger } from '@mailguard/core';

const logger = getLogger('api:security');

/**
 * HTTPS enforcement middleware
 * In production, reject non-HTTPS requests
 */
export async function enforceHttps(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!isProduction()) {
    return;
  }
  
  // Check if the request is HTTPS
  const protocol = request.headers['x-forwarded-proto'] ?? 'http';
  const isHttps = protocol === 'https' || request.protocol === 'https';
  
  if (!isHttps) {
    logger.warn({ ip: request.ip, path: request.url }, 'Rejected non-HTTPS request');
    await reply.status(HTTP_STATUS.FORBIDDEN).send({
      error: 'https_required',
      message: 'HTTPS is required in production',
    });
    return;
  }
}

/**
 * Add security headers to all responses
 */
export function addSecurityHeaders(
  _request: FastifyRequest,
  reply: FastifyReply
): void {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('X-XSS-Protection', '1; mode=block');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  if (isProduction()) {
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

/**
 * Request logging middleware
 */
export function logRequest(
  request: FastifyRequest,
  reply: FastifyReply
): void {
  const startTime = Date.now();
  
  reply.then(() => {
    const duration = Date.now() - startTime;
    logger.info({
      method: request.method,
      url: request.url,
      status: reply.statusCode,
      duration,
      ip: request.ip,
    }, 'Request completed');
  }, (err: Error) => {
    const duration = Date.now() - startTime;
    logger.error({
      method: request.method,
      url: request.url,
      status: reply.statusCode,
      duration,
      ip: request.ip,
      error: err.message,
    }, 'Request failed');
  });
}