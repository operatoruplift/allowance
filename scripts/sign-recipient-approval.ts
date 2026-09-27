import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import {
  createKeyPairFromBytes,
  getAddressFromPublicKey,
  getBase58Decoder,
  getUtf8Encoder,
  signBytes,
} from '@solana/kit';
import { addressSchema } from '../shared/domain.js';
import { approvalMessage, recipientApprovalSchema } from '../shared/mandate.js';

/**
 * Signs a recipient approval with an administrator keypair file and prints the
 * JSON body for POST /api/mandates/:id/recipients or the MCP tool
 * add_recipient_to_allowlist. The key never leaves this process; only the
 * signature does. A wallet that signs plain messages produces the same bytes.
 *
 *   npm run approve:recipient -- --mandate <uuid> --recipient <address> --label "Vendor" --key secrets/admin.json [--minutes 30]
 */
function flag(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (!value && fallback === undefined) throw new Error(`Missing --${name}.`);
  return value ?? fallback!;
}
const mandateId = flag('mandate');
if (!/^[0-9a-f-]{36}$/.test(mandateId)) throw new Error('--mandate must be a mandate UUID.');
const address = addressSchema.parse(flag('recipient'));
const label = flag('label');
const minutes = Number(flag('minutes', '30'));
if (!Number.isInteger(minutes) || minutes < 1 || minutes > 24 * 60)
  throw new Error('--minutes must be between 1 and 1440.');
const raw = JSON.parse(await readFile(flag('key'), 'utf8')) as unknown;
if (!Array.isArray(raw) || raw.length !== 64) throw new Error('The key file must hold a 64-byte JSON array.');
const bytes = Uint8Array.from(raw as number[]);
const keyPair = await createKeyPairFromBytes(bytes);
bytes.fill(0);
const signer = await getAddressFromPublicKey(keyPair.publicKey);
const nonce = randomBytes(18).toString('base64url');
const expiresAt = new Date(Date.now() + minutes * 60_000).toISOString();
const message = approvalMessage({ mandateId, address, label, nonce, expiresAt });
const signature = getBase58Decoder().decode(await signBytes(keyPair.privateKey, getUtf8Encoder().encode(message)));
const body = recipientApprovalSchema.parse({ address, label, nonce, expiresAt, signer, signature });
process.stderr.write(`Signed by ${signer}; valid until ${expiresAt}. Message:\n${message}\n\n`);
process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
