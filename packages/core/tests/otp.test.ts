import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateOtp,
  hashOtp,
  verifyOtpHash,
  isOtpExpired,
  isOtpLocked,
  calculateExpiryDate,
  getSecondsUntilExpiry,
  getExpiryMinutes,
} from '../src/otp';

describe('OTP Module', () => {
  describe('generateOtp', () => {
    it('should generate a 4-digit OTP', () => {
      const otp = generateOtp(4);
      expect(otp).toHaveLength(4);
      expect(/^\d{4}$/.test(otp)).toBe(true);
    });

    it('should generate a 6-digit OTP', () => {
      const otp = generateOtp(6);
      expect(otp).toHaveLength(6);
      expect(/^\d{6}$/.test(otp)).toBe(true);
    });

    it('should generate an 8-digit OTP', () => {
      const otp = generateOtp(8);
      expect(otp).toHaveLength(8);
      expect(/^\d{8}$/.test(otp)).toBe(true);
    });

    it('should throw error for invalid length', () => {
      expect(() => generateOtp(3)).toThrow('OTP length must be 4, 6, or 8 digits');
      expect(() => generateOtp(5)).toThrow('OTP length must be 4, 6, or 8 digits');
      expect(() => generateOtp(7)).toThrow('OTP length must be 4, 6, or 8 digits');
      expect(() => generateOtp(9)).toThrow('OTP length must be 4, 6, or 8 digits');
    });

    it('should generate unique OTPs', () => {
      const otps = new Set<string>();
      for (let i = 0; i < 100; i++) {
        otps.add(generateOtp(6));
      }
      // With 100 random 6-digit OTPs, we expect a high degree of uniqueness
      expect(otps.size).toBeGreaterThan(90);
    });

    it('should preserve leading zeros', () => {
      // Generate many OTPs and check if any have leading zeros
      const otps = Array.from({ length: 1000 }, () => generateOtp(6));
      const hasLeadingZero = otps.some(otp => otp.startsWith('0'));
      // Leading zeros are valid and should be preserved
      expect(hasLeadingZero).toBe(true);
    });
  });

  describe('hashOtp and verifyOtpHash', () => {
    it('should hash an OTP code', async () => {
      const otp = '123456';
      const hash = await hashOtp(otp);
      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
      expect(hash).not.toBe(otp);
      expect(hash.startsWith('$2a$') || hash.startsWith('$2b$')).toBe(true);
    });

    it('should verify a correct OTP code', async () => {
      const otp = '654321';
      const hash = await hashOtp(otp);
      const isValid = await verifyOtpHash(otp, hash);
      expect(isValid).toBe(true);
    });

    it('should reject an incorrect OTP code', async () => {
      const otp = '123456';
      const wrongOtp = '654321';
      const hash = await hashOtp(otp);
      const isValid = await verifyOtpHash(wrongOtp, hash);
      expect(isValid).toBe(false);
    });

    it('should generate different hashes for the same OTP', async () => {
      const otp = '123456';
      const hash1 = await hashOtp(otp);
      const hash2 = await hashOtp(otp);
      // bcrypt generates unique salts, so hashes should differ
      expect(hash1).not.toBe(hash2);
    });

    it('should verify both hashes for the same OTP', async () => {
      const otp = '123456';
      const hash1 = await hashOtp(otp);
      const hash2 = await hashOtp(otp);
      expect(await verifyOtpHash(otp, hash1)).toBe(true);
      expect(await verifyOtpHash(otp, hash2)).toBe(true);
    });
  });

  describe('isOtpExpired', () => {
    it('should return true for past dates', () => {
      const pastDate = new Date(Date.now() - 1000);
      expect(isOtpExpired(pastDate)).toBe(true);
    });

    it('should return false for future dates', () => {
      const futureDate = new Date(Date.now() + 60000);
      expect(isOtpExpired(futureDate)).toBe(false);
    });

    it('should return true for current time', () => {
      const now = new Date();
      expect(isOtpExpired(now)).toBe(true);
    });
  });

  describe('isOtpLocked', () => {
    it('should return false when attempts are below max', () => {
      expect(isOtpLocked(0, 5)).toBe(false);
      expect(isOtpLocked(2, 5)).toBe(false);
      expect(isOtpLocked(4, 5)).toBe(false);
    });

    it('should return true when attempts equal max', () => {
      expect(isOtpLocked(5, 5)).toBe(true);
    });

    it('should return true when attempts exceed max', () => {
      expect(isOtpLocked(6, 5)).toBe(true);
      expect(isOtpLocked(10, 5)).toBe(true);
    });
  });

  describe('calculateExpiryDate', () => {
    it('should calculate correct expiry date', () => {
      const seconds = 300; // 5 minutes
      const expiryDate = calculateExpiryDate(seconds);
      const expectedTime = Date.now() + seconds * 1000;
      // Allow 100ms tolerance for test execution
      expect(expiryDate.getTime()).toBeGreaterThanOrEqual(expectedTime - 100);
      expect(expiryDate.getTime()).toBeLessThanOrEqual(expectedTime + 100);
    });
  });

  describe('getSecondsUntilExpiry', () => {
    it('should return correct seconds for future date', () => {
      const futureDate = new Date(Date.now() + 65000); // 65 seconds from now
      const seconds = getSecondsUntilExpiry(futureDate);
      expect(seconds).toBeGreaterThanOrEqual(64);
      expect(seconds).toBeLessThanOrEqual(65);
    });

    it('should return 0 for past date', () => {
      const pastDate = new Date(Date.now() - 1000);
      expect(getSecondsUntilExpiry(pastDate)).toBe(0);
    });
  });

  describe('getExpiryMinutes', () => {
    it('should round up to nearest minute', () => {
      expect(getExpiryMinutes(60)).toBe(1);
      expect(getExpiryMinutes(61)).toBe(2);
      expect(getExpiryMinutes(119)).toBe(2);
      expect(getExpiryMinutes(120)).toBe(2);
      expect(getExpiryMinutes(121)).toBe(3);
    });
  });
});