/**
 * Shared AES-256-GCM helpers backed by BROKER_MASTER_KEY.
 *
 * Used by:
 *   - AppConfigService  (encrypting config secrets at rest)
 *   - SQLiteBrokerRepository  (encrypting broker credentials)
 *   - StorageService  (legacy — re-exports from here)
 *
 * Key derivation:
 *   64-char hex string  → use directly as 32-byte key
 *   anything else       → SHA-256 hash to 32 bytes
 *
 * The key is read from process.env.BROKER_MASTER_KEY at call time (not
 * module load), so the env var can be set after this module is imported.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { EncryptedBlob } from '../types/broker.js';

export function getMasterKey(): Buffer {
  const raw = process.env.BROKER_MASTER_KEY;
  if (!raw) throw new Error('[crypto] BROKER_MASTER_KEY env var is not set');
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  return createHash('sha256').update(raw).digest();
}

export function encryptWithMasterKey(plaintext: string): EncryptedBlob {
  const key = getMasterKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    iv:         iv.toString('hex'),
    authTag:    cipher.getAuthTag().toString('hex'),
    ciphertext: ciphertext.toString('hex'),
  };
}

export function decryptWithMasterKey(blob: EncryptedBlob): string {
  const key = getMasterKey();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(blob.authTag, 'hex'));
  return decipher.update(Buffer.from(blob.ciphertext, 'hex')).toString('utf8')
       + decipher.final('utf8');
}
