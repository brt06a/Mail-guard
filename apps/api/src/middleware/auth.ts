import type { FastifyRequest, FastifyReply } from 'fastify';
import { validateApiKey, ERROR_CODES, HTTP_STATUS, getLogger, type ApiKeyWithProject } from '@mailguard/core';
import { getAuthToken } from '../utils/request';

const logger = getLogger('api:auth');

declare module 'fastify' {
  interface FastifyRequest {
    apiKey: ApiKeyWithProject;
    isSandbox: boolean;
  }
}

/**
 * Authentication middleware
 * Validates API key from Authorization header
 */
export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const token = getAuthToken(request);
  
  if (!token) {
    await reply.status(HTTP_STATUS.UNAUTHORIZED).send({
      error: ERROR_CODES.UNAUTHORIZED,
      message: 'Missing or invalid Authorization header',
    });
    return;
  }
  
  const validation = await validateApiKey(token);
  
  if (!validation.valid) {
    logger.warn({ error: validation.error }, 'API key validation failed');
    
    const statusCode = validation.error === ERROR_CODES.KEY_REVOKED 
      ? HTTP_STATUS.FORBIDDEN 
      : validation.error === ERROR_CODES.KEY_EXPIRED
        ? HTTP_STATUS.FORBIDDEN
        : HTTP_STATUS.UNAUTHORIZED;
    
    await reply.status(statusCode).send({
      error: validation.error ?? ERROR_CODES.INVALID_API_KEY,
      message: getErrorMessage(validation.error),
    });
    return;
  }
  
  // Attach to request
  request.apiKey = validation.apiKey!;
  request.isSandbox = validation.apiKey!.isSandbox;
}

/**
 * Get user-friendly error message for API key errors
 */
function getErrorMessage(error: string | undefined): string {
  switch (error) {
    case ERROR_CODES.KEY_REVOKED:
      return 'API key has been revoked';
    case ERROR_CODES.KEY_EXPIRED:
      return 'API key has expired';
    case ERROR_CODES.INVALID_API_KEY:
      return 'Invalid API key';
    default:
      return 'Authentication failed';
  }
}