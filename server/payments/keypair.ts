import { readFile } from 'node:fs/promises';
import { createKeyPairSignerFromBytes, type KeyPairSigner } from '@solana/kit';

/**
 * The one way a payer key enters the process: a 64-byte JSON array from a file
 * the operator controls or from the private server environment. The bytes are
 * zeroed as soon as the signer exists, and the parsed key never leaves this module.
 */
export async function loadPayerSigner(source: {
  keyFile?: string;
  secretKey?: string;
}): Promise<KeyPairSigner> {
  const raw = source.secretKey || (source.keyFile ? await readFile(source.keyFile, 'utf8') : '');
  if (!raw) throw new Error('No payer secret source is configured.');
  const key: unknown = JSON.parse(raw);
  if (
    !Array.isArray(key) ||
    key.length !== 64 ||
    key.some((v) => !Number.isInteger(v) || v < 0 || v > 255)
  )
    throw new Error('Invalid keypair.');
  const bytes = Uint8Array.from(key as number[]);
  try {
    return await createKeyPairSignerFromBytes(bytes);
  } finally {
    bytes.fill(0);
  }
}
