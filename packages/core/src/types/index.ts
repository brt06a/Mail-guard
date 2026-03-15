import type { OtpFormat, EmailType, EmailStatus, Project, SenderEmail, ApiKey, OtpRecord, EmailLog, BotSession } from '@prisma/client';

// Re-export Prisma types
export type {
  Project,
  SenderEmail,
  ApiKey,
  OtpRecord,
  EmailLog,
  BotSession,
  OtpFormat,
  EmailType,
  EmailStatus,
};

/**
 * Project with sender email relation
 */
export interface ProjectWithSender extends Project {
  senderEmail: SenderEmail;
}

/**
 * API key with project relation
 */
export interface ApiKeyWithProject extends ApiKey {
  project: Project;
}

/**
 * OTP record with project relation
 */
export interface OtpRecordWithProject extends OtpRecord {
  project: Project;
}

/**
 * Email log with all relations
 */
export interface EmailLogWithRelations extends EmailLog {
  project: Project;
  senderEmail: SenderEmail;
}

/**
 * Sender email with project count
 */
export interface SenderEmailWithProjects extends SenderEmail {
  _count?: {
    projects: number;
  };
}

// API Request types

export interface SendOtpRequest {
  email: string;
  purpose?: string;
}

export interface VerifyOtpRequest {
  email: string;
  code: string;
}

export interface SendEmailRequest {
  to: string;
  subject: string;
  body: string;
  format?: 'text' | 'html';
}

// API Response types

export interface SendOtpResponse {
  id: string;
  status: 'sent' | 'queued';
  expires_in: number;
  masked_email: string;
}

export interface VerifyOtpSuccessResponse {
  verified: true;
  token: string;
  expires_at: string;
}

export interface VerifyOtpFailureResponse {
  verified: false;
  error: string;
  attempts_remaining?: number;
}

export type VerifyOtpResponse = VerifyOtpSuccessResponse | VerifyOtpFailureResponse;

export interface HealthCheckResponse {
  status: 'ok' | 'degraded' | 'error';
  db: 'ok' | 'error';
  redis: 'ok' | 'error';
  bot: 'ok' | 'error' | 'not_configured';
  queue: {
    waiting: number;
    active: number;
  };
  senders: Array<{
    id: string;
    email: string;
    provider: string;
    status: 'ok' | 'error';
    daily_limit: number;
    sent_today: number;
  }>;
  memory?: {
    used: number;
    total: number;
    percentage: number;
  };
}

export interface ErrorResponse {
  error: string;
  message?: string;
  retry_after?: number;
  attempts_remaining?: number;
}

// Queue job data types

export interface EmailJobData {
  otpRecordId?: string;
  senderEmailId: string;
  recipientEmail: string;
  subject: string;
  body: string;
  format: 'text' | 'html';
  projectId: string;
  emailLogId?: string;
}

export interface OtpCleanupJobData {
  timestamp: number;
}

export interface TelegramNotificationJobData {
  type: 'smtp_failure' | 'rate_limit_hit' | 'api_key_created' | 'daily_summary';
  data: Record<string, unknown>;
}

// Provider detection types

export interface ProviderConfig {
  provider: string;
  smtpHost: string;
  smtpPort: number;
  dailyLimit: number;
}

// Telegram bot types

export interface BotSessionData {
  step?: string;
  data?: Record<string, unknown>;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface BotContext {
  from?: {
    id: number;
    is_bot: boolean;
    first_name: string;
    username?: string;
  };
  chat?: {
    id: number;
    type: string;
  };
  message?: {
    text?: string;
    message_id: number;
  };
  callbackQuery?: {
    id: string;
    data?: string;
  };
}

// API Key types

export interface GeneratedApiKey {
  fullKey: string;
  keyHash: string;
  keyPrefix: string;
}

export interface ApiKeyValidation {
  valid: boolean;
  apiKey?: ApiKeyWithProject;
  error?: string;
}

// Pagination types

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  hasMore: boolean;
}

// Rate limit types

export interface RateLimitInfo {
  limited: boolean;
  retryAfter?: number;
}

// JWT payload types

export interface OtpTokenPayload {
  sub: string; // recipient email
  projectId: string;
  purpose: string;
  otpRecordId: string;
  iat: number;
  exp: number;
}

// Email template types

export interface OtpTemplateData {
  otp_code: string;
  app_name: string;
  expiry_minutes: number;
  expiry_seconds: number;
  recipient_email: string;
  purpose: string;
}

// SMTP verification result

export interface SmtpVerificationResult {
  success: boolean;
  error?: string;
  latency?: number;
}