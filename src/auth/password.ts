import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Password hashing built on Node's crypto.
 */

const KEY_LENGTH = 64;

export function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(plain, salt, KEY_LENGTH).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;

  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(plain, salt, KEY_LENGTH);

  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
