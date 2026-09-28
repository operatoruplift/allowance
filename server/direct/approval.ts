import {
  address,
  getBase58Encoder,
  getPublicKeyFromAddress,
  getUtf8Encoder,
  verifySignature,
  type SignatureBytes,
} from '@solana/kit';
import { approvalMessage, type RecipientApproval } from '../../shared/mandate.js';

/** At most one day between signing an approval and using it; a stale approval is refused. */
export const APPROVAL_MAX_WINDOW_MS = 24 * 60 * 60 * 1000;

export class ApprovalError extends Error {
  constructor(
    public code:
      | 'admin-not-configured'
      | 'wrong-signer'
      | 'approval-expired'
      | 'approval-window'
      | 'bad-signature',
    message: string
  ) {
    super(message);
  }
}

/**
 * An administrator adds a recipient by signing the exact approval text with the
 * configured admin key (a plain Ed25519 message signature, the kind a wallet's
 * "sign message" produces). The nonce is consumed by the ledger so a captured
 * approval cannot be replayed onto another mandate or a second time.
 */
export async function verifyRecipientApproval(
  mandateId: string,
  approval: RecipientApproval,
  adminPublicKey: string,
  now = Date.now()
): Promise<void> {
  if (!adminPublicKey)
    throw new ApprovalError(
      'admin-not-configured',
      'No administrator key is configured, so recipients cannot be added after authorization.'
    );
  if (approval.signer !== adminPublicKey)
    throw new ApprovalError('wrong-signer', 'The approval was not signed by the administrator key.');
  const expiresAt = Date.parse(approval.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now)
    throw new ApprovalError('approval-expired', 'The approval has expired.');
  if (expiresAt - now > APPROVAL_MAX_WINDOW_MS)
    throw new ApprovalError('approval-window', 'The approval expiry is too far in the future.');
  const message = getUtf8Encoder().encode(
    approvalMessage({
      mandateId,
      address: approval.address,
      label: approval.label,
      nonce: approval.nonce,
      expiresAt: approval.expiresAt,
    })
  );
  const key = await getPublicKeyFromAddress(address(approval.signer));
  const signature = getBase58Encoder().encode(approval.signature) as SignatureBytes;
  if (signature.byteLength !== 64 || !(await verifySignature(key, signature, message)))
    throw new ApprovalError('bad-signature', 'The approval signature does not verify.');
}
