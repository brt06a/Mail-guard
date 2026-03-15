import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';

const BCRYPT_COST = 10;

/**
 * Generates a secure numeric OTP using cryptographically secure random numbers
 * 
 * @param length - Number of digits (4, 6, or 8)
 * @returns Numeric OTP string, zero-padded to the specified length
 */
export function generateOtp(length: number): string {
  if (![4, 6, 8].includes(length)) {
    throw new Error('OTP length must be 4, 6, or 8 digits');
  }
  
  const max = Math.pow(10, length);
  const otp = crypto.randomInt(0, max);
  return otp.toString().padStart(length, '0');
}

/**
 * Hashes an OTP code using bcrypt with cost factor 10
 * 
 * @param otpCode - The plaintext OTP code
 * @returns bcrypt hash of the OTP
 */
export async function hashOtp(otpCode: string): Promise<string> {
  return bcrypt.hash(otpCode, BCRYPT_COST);
}

/**
 * Verifies an OTP code against a bcrypt hash using constant-time comparison
 * 
 * @param submittedCode - The OTP code submitted by the user
 * @param hashedOtp - The bcrypt hash of the original OTP
 * @returns true if the OTP matches, false otherwise
 */
export async function verifyOtpHash(submittedCode: string, hashedOtp: string): Promise<boolean> {
  return bcrypt.compare(submittedCode, hashedOtp);
}

/**
 * Checks if an OTP record is expired based on its expiration timestamp
 * 
 * @param expiresAt - The expiration timestamp
 * @returns true if expired, false if still valid
 */
export function isOtpExpired(expiresAt: Date): boolean {
  return new Date() > expiresAt;
}

/**
 * Checks if an OTP record is locked due to too many failed attempts
 * 
 * @param attemptsCount - The number of failed attempts
 * @param maxAttempts - The maximum allowed attempts
 * @returns true if locked, false if attempts remaining
 */
export function isOtpLocked(attemptsCount: number, maxAttempts: number): boolean {
  return attemptsCount >= maxAttempts;
}

/**
 * Calculates the expiration date for an OTP
 * 
 * @param expirySeconds - Number of seconds until expiration
 * @returns Date object representing the expiration time
 */
export function calculateExpiryDate(expirySeconds: number): Date {
  return new Date(Date.now() + expirySeconds * 1000);
}

/**
 * Calculates the remaining seconds until expiration
 * 
 * @param expiresAt - The expiration timestamp
 * @returns Number of seconds remaining, or 0 if expired
 */
export function getSecondsUntilExpiry(expiresAt: Date): number {
  const now = new Date();
  const diff = expiresAt.getTime() - now.getTime();
  return Math.max(0, Math.floor(diff / 1000));
}

/**
 * Calculates the minutes until expiration for display purposes
 * 
 * @param expirySeconds - The expiry duration in seconds
 * @returns Number of minutes (rounded up for display)
 */
export function getExpiryMinutes(expirySeconds: number): number {
  return Math.ceil(expirySeconds / 60);
}