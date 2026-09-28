import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  PAYMENT_CHAINS,
  parseMoney,
  paymentNetworkName,
  units,
  type PaymentNetwork,
} from '../../shared/domain.js';
import {
  MANDATE_VERSION,
  MAX_MANDATE_RECIPIENTS,
  decideDirectPayment,
  explorerTransactionUrl,
  type CreateMandateInput,
  type DirectDenialCode,
  type DirectPaymentDTO,
  type DirectPaymentRequest,
  type DirectPaymentStatus,
  type MandateDTO,
  type MandateEventDTO,
  type MandatePolicy,
  type MandateRecipient,
  type MandateStatus,
  type RecipientApproval,
} from '../../shared/mandate.js';
import type { Config } from '../config.js';
import { PolicyError } from '../policy/decision.js';
import type { Ledger } from '../policy/ledger.js';
import type { DirectSettlementEvidence } from './transfer.js';
import { assertMandateAuthorization } from './grants.js';

interface MandateRow {
  id: string;
  owner: string;
  label: string;
  status: 'active' | 'stopped' | 'expired';
  policy: string;
  created_at: string;
  stopped_at: string | null;
}
interface RecipientRow {
  mandate_id: string;
  address: string;
  label: string;
  added_at: string;
  added_by: MandateRecipient['addedBy'];
  approval: string | null;
}
interface PaymentRow {
  id: string;
  mandate_id: string;
  request_hash: string;
  recipient: string;
  amount: number;
  memo: string | null;
  status: DirectPaymentStatus;
  reason_code: DirectDenialCode | null;
  reason: string | null;
  created_at: string;
  day: string;
  source: DirectPaymentDTO['source'];
  signed_identity: string | null;
  signature: string | null;
  chain_verified: number;
  evidence: string | null;
}
export interface SigningClaim {
  messageHash: string;
  blockhash: string;
  lastValidBlockHeight: string;
  payer: string;
  source: string;
  destination: string;
  createRecipientAccount: boolean;
}
export interface SignedIdentity extends SigningClaim {
  phase: 'signing' | 'signed';
  signature?: string;
  wire?: string;
}
const settledStates: DirectPaymentStatus[] = ['settled'];
const heldStates: DirectPaymentStatus[] = ['reserved', 'submitted', 'settlement-unknown'];
const requestHash = (request: { recipient: string; amount: number; memo?: string }) =>
  createHash('sha256')
    .update(JSON.stringify({ recipient: request.recipient, amount: request.amount, memo: request.memo ?? '' }), 'utf8')
    .digest('hex');

/**
 * The durable record of mandates and the direct payments made under them. It
 * mirrors the x402 ledger: reserve under BEGIN IMMEDIATE, claim signing before
 * the signer is invoked, and never let a signed payment disappear from the
 * hold until chain evidence resolves it.
 */
export class MandateLedger {
  constructor(
    public db: Database.Database,
    public config: Config,
    private ledger: Ledger,
    private now: () => number = Date.now,
    private assertOwnership: () => void = () => {}
  ) {}
  private time() {
    return new Date(this.now()).toISOString();
  }
  private row(id: string): MandateRow {
    const row = this.db.prepare('SELECT * FROM mandates WHERE id=?').get(id) as MandateRow | undefined;
    if (!row) throw new Error('Mandate not found.');
    return row;
  }
  private paymentRow(id: string): PaymentRow {
    const row = this.db.prepare('SELECT * FROM direct_payments WHERE id=?').get(id) as
      PaymentRow | undefined;
    if (!row) throw new Error('Direct payment not found.');
    return row;
  }
  private recipientRows(id: string): RecipientRow[] {
    return this.db
      .prepare('SELECT * FROM mandate_recipients WHERE mandate_id=? ORDER BY added_at,address')
      .all(id) as RecipientRow[];
  }
  private paymentRows(id: string): PaymentRow[] {
    return this.db
      .prepare('SELECT * FROM direct_payments WHERE mandate_id=? ORDER BY created_at,id')
      .all(id) as PaymentRow[];
  }
  private amounts(id: string) {
    const rows = this.paymentRows(id);
    return {
      settled: rows.filter((r) => settledStates.includes(r.status)).reduce((s, r) => s + r.amount, 0),
      held: rows.filter((r) => heldStates.includes(r.status)).reduce((s, r) => s + r.amount, 0),
    };
  }
  private status(row: MandateRow, policy: MandatePolicy): MandateStatus {
    if (row.status === 'stopped') return 'stopped';
    return this.now() >= Date.parse(policy.expiresAt) ? 'expired' : 'active';
  }
  recipientAddresses(id: string): string[] {
    return this.recipientRows(id).map((row) => row.address);
  }
  event(
    mandateId: string,
    kind: string,
    title: string,
    detail: string,
    source: MandateEventDTO['source'] = 'system'
  ) {
    this.db
      .prepare('INSERT INTO mandate_events(mandate_id,at,kind,title,detail,source) VALUES(?,?,?,?,?,?)')
      .run(mandateId, this.time(), kind, title, detail.slice(0, 4000), source);
  }
  create(input: CreateMandateInput, payer: string, owner = 'operator'): MandateDTO {
    this.assertOwnership();
    const cap = parseMoney(input.perRequestCap);
    const ceiling = parseMoney(input.ceiling);
    if (ceiling > this.config.dailyCeiling)
      throw new PolicyError('Mandate ceiling exceeds the configured daily ceiling.');
    if (cap > ceiling) throw new PolicyError('Per-request cap cannot exceed the mandate ceiling.');
    if (input.recipients.some((recipient) => recipient.address === payer))
      throw new PolicyError('The payer cannot be listed as a recipient.');
    const chain = PAYMENT_CHAINS[this.config.paymentNetwork];
    const policy: MandatePolicy = {
      version: MANDATE_VERSION,
      network: chain.network,
      mint: chain.mint,
      payer,
      perRequestCap: String(cap),
      ceiling: String(ceiling),
      dailyCeiling: String(this.config.dailyCeiling),
      expiresAt: new Date(this.now() + input.expiresInMinutes * 60000).toISOString(),
    };
    const id = randomUUID();
    this.db
      .transaction(() => {
        if (this.ledger.payerFrozen())
          throw new PolicyError('Payer is held pending reconciliation.');
        this.db
          .prepare('INSERT INTO mandates(id,owner,label,status,policy,created_at) VALUES(?,?,?,?,?,?)')
          .run(id, owner, input.label, 'active', JSON.stringify(policy), this.time());
        const insert = this.db.prepare(
          'INSERT INTO mandate_recipients(mandate_id,address,label,added_at,added_by) VALUES(?,?,?,?,?)'
        );
        for (const recipient of input.recipients)
          insert.run(id, recipient.address, recipient.label, this.time(), 'operator');
        this.event(
          id,
          'authorization',
          'Mandate authorized',
          `${input.ceiling} ${this.config.paymentNetwork} USDC ceiling, ${input.perRequestCap} per request, ${input.recipients.length} recipient${input.recipients.length === 1 ? '' : 's'}. Mandate version ${MANDATE_VERSION} is immutable.`,
          'policy'
        );
      })
      .immediate();
    return this.get(id, owner);
  }
  private toPayment(row: PaymentRow, policy: MandatePolicy, recipients: RecipientRow[]): DirectPaymentDTO {
    const evidence = row.evidence ? (JSON.parse(row.evidence) as Partial<DirectSettlementEvidence>) : undefined;
    const network: PaymentNetwork = paymentNetworkName(policy.network);
    const label = recipients.find((recipient) => recipient.address === row.recipient)?.label;
    return {
      id: row.id,
      mandateId: row.mandate_id,
      requestId: row.id,
      recipient: row.recipient,
      ...(label ? { recipientLabel: label } : {}),
      amount: String(row.amount),
      ...(row.memo ? { memo: row.memo } : {}),
      status: row.status,
      ...(row.reason_code ? { reasonCode: row.reason_code } : {}),
      ...(row.reason ? { reason: row.reason } : {}),
      createdAt: row.created_at,
      paymentNetwork: network,
      mint: policy.mint,
      ...(row.signature ? { signature: row.signature, explorerUrl: explorerTransactionUrl(network, row.signature) } : {}),
      chainVerified: row.chain_verified === 1,
      ...(evidence?.slot !== undefined ? { slot: String(evidence.slot) } : {}),
      ...(evidence?.feeLamports ? { feeLamports: evidence.feeLamports } : {}),
      ...(evidence?.createdRecipientAccount !== undefined
        ? { createdRecipientAccount: evidence.createdRecipientAccount }
        : {}),
      ...(evidence?.proofObservedAt ? { proofObservedAt: evidence.proofObservedAt } : {}),
      source: row.source,
    };
  }
  get(id: string, owner = 'operator'): MandateDTO {
    const row = this.row(id);
    if (row.owner !== owner) throw new Error('Mandate not found.');
    const policy = JSON.parse(row.policy) as MandatePolicy;
    const recipients = this.recipientRows(id);
    const amounts = this.amounts(id);
    const events = this.db
      .prepare('SELECT id,at,kind,title,detail,source FROM mandate_events WHERE mandate_id=? ORDER BY id')
      .all(id) as MandateEventDTO[];
    return {
      id: row.id,
      receiptVersion: 1,
      label: row.label,
      status: this.status(row, policy),
      policyHash: createHash('sha256').update(row.policy, 'utf8').digest('hex'),
      policy,
      paymentNetwork: paymentNetworkName(policy.network),
      createdAt: row.created_at,
      ...(row.stopped_at ? { stoppedAt: row.stopped_at } : {}),
      recipients: recipients.map((recipient) => {
        const approval = recipient.approval
          ? (JSON.parse(recipient.approval) as { signer?: string })
          : undefined;
        return {
          address: recipient.address,
          label: recipient.label,
          addedAt: recipient.added_at,
          addedBy: recipient.added_by,
          ...(approval?.signer ? { approvedBy: approval.signer } : {}),
        };
      }),
      ceiling: policy.ceiling,
      settled: String(amounts.settled),
      held: String(amounts.held),
      remaining: String(units(policy.ceiling) - amounts.settled - amounts.held),
      dailyCeiling: policy.dailyCeiling,
      payments: this.paymentRows(id).map((payment) => this.toPayment(payment, policy, recipients)),
      events,
    };
  }
  list(owner = 'operator'): MandateDTO[] {
    return (
      this.db
        .prepare('SELECT id FROM mandates WHERE owner=? ORDER BY created_at DESC LIMIT 30')
        .all(owner) as { id: string }[]
    ).map((row) => this.get(row.id, owner));
  }
  getPayment(id: string): DirectPaymentDTO | undefined {
    const row = this.db.prepare('SELECT * FROM direct_payments WHERE id=?').get(id) as
      PaymentRow | undefined;
    if (!row) return undefined;
    const mandate = this.row(row.mandate_id);
    return this.toPayment(row, JSON.parse(mandate.policy) as MandatePolicy, this.recipientRows(row.mandate_id));
  }
  /** Persists a verified administrator approval and consumes its nonce in the same transaction. */
  addRecipient(id: string, approval: RecipientApproval, owner = 'operator'): MandateDTO {
    this.assertOwnership();
    this.db
      .transaction(() => {
        const row = this.row(id);
        if (row.owner !== owner) throw new Error('Mandate not found.');
        const policy = JSON.parse(row.policy) as MandatePolicy;
        if (this.status(row, policy) !== 'active')
          throw new PolicyError('Mandate is no longer active; recipients cannot change.');
        if (approval.address === policy.payer)
          throw new PolicyError('The payer cannot be listed as a recipient.');
        const recipients = this.recipientRows(id);
        if (recipients.some((recipient) => recipient.address === approval.address))
          throw new PolicyError('Recipient is already on the allowlist.');
        if (recipients.length >= MAX_MANDATE_RECIPIENTS)
          throw new PolicyError('The mandate already lists the maximum number of recipients.');
        if (this.db.prepare('SELECT 1 FROM approval_nonces WHERE nonce=?').get(approval.nonce))
          throw new PolicyError('This approval nonce has already been used.');
        this.db
          .prepare('INSERT INTO approval_nonces(nonce,mandate_id,signer,used_at) VALUES(?,?,?,?)')
          .run(approval.nonce, id, approval.signer, this.time());
        this.db
          .prepare(
            'INSERT INTO mandate_recipients(mandate_id,address,label,added_at,added_by,approval) VALUES(?,?,?,?,?,?)'
          )
          .run(
            id,
            approval.address,
            approval.label,
            this.time(),
            'admin-signature',
            JSON.stringify({
              signer: approval.signer,
              nonce: approval.nonce,
              expiresAt: approval.expiresAt,
              signature: approval.signature,
            })
          );
        this.event(
          id,
          'recipient-added',
          'Recipient added by administrator signature',
          `${approval.label} (${approval.address}) approved by ${approval.signer}.`,
          'policy'
        );
      })
      .immediate();
    return this.get(id, owner);
  }
  stop(id: string, owner = 'operator'): MandateDTO {
    this.get(id, owner);
    this.db
      .transaction(() => {
        this.db
          .prepare("UPDATE mandates SET status='stopped',stopped_at=? WHERE id=? AND status='active'")
          .run(this.time(), id);
        this.db
          .prepare(
            "UPDATE direct_payments SET status='released',reason='Mandate stopped before signing.' WHERE mandate_id=? AND status='reserved' AND signed_identity IS NULL"
          )
          .run(id);
        this.event(
          id,
          'stop',
          'Stop requested',
          'No new signatures. Submitted or uncertain payments remain visible and may settle.',
          'policy'
        );
      })
      .immediate();
    return this.get(id, owner);
  }
  /**
   * The only entry point for a new direct payment. Runs the pure decision under an
   * immediate transaction and records the outcome either way, so a denied request
   * is a durable receipt rather than a lost error.
   */
  reserve(
    mandateId: string,
    request: DirectPaymentRequest,
    source: DirectPaymentDTO['source'],
    owner = 'operator'
  ): { created: boolean; payment: DirectPaymentDTO } {
    const amount = parseMoney(request.amount);
    const hash = requestHash({ recipient: request.recipient, amount, memo: request.memo });
    const outcome = this.db
      .transaction(() => {
        this.assertOwnership();
        // The request id is the idempotency key. The same terms under a new id are a
        // new payment (two invoices to one vendor are ordinary); the same id with
        // different terms is a conflict, never a silent substitution.
        const existing = this.db
          .prepare('SELECT * FROM direct_payments WHERE id=?')
          .get(request.requestId) as PaymentRow | undefined;
        if (existing) {
          if (existing.mandate_id !== mandateId || existing.request_hash !== hash)
            throw new PolicyError('Idempotency ID conflicts with a different request.');
          return { created: false, id: existing.id };
        }
        const row = this.row(mandateId);
        if (row.owner !== owner) throw new Error('Mandate not found.');
        if (source === 'external-agent')
          assertMandateAuthorization(this.db, row.id, row.owner, 'execute_guarded_payment', this.now());
        const policy = JSON.parse(row.policy) as MandatePolicy;
        const decision = decideDirectPayment(
          {
            policy,
            status: this.status(row, policy),
            recipients: this.recipientAddresses(mandateId),
            ...this.amounts(mandateId),
            dailyUsed: this.ledger.dailyUsed(),
            dailyCeiling: this.config.dailyCeiling,
            payerFrozen: this.ledger.payerFrozen(),
            now: this.now(),
          },
          { recipient: request.recipient, amount: String(amount), network: policy.network, mint: policy.mint }
        );
        this.db
          .prepare(
            'INSERT INTO direct_payments(id,mandate_id,request_hash,recipient,amount,memo,status,reason_code,reason,created_at,day,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)'
          )
          .run(
            request.requestId,
            mandateId,
            hash,
            request.recipient,
            amount,
            request.memo ?? null,
            decision.allowed ? 'reserved' : 'denied',
            decision.allowed ? null : decision.code,
            decision.reason,
            this.time(),
            this.time().slice(0, 10),
            source
          );
        this.event(
          mandateId,
          decision.allowed ? 'reserved' : 'denied',
          decision.allowed ? 'Funds reserved' : 'Request blocked',
          `${request.amount} USDC to ${request.recipient}: ${decision.reason}`,
          source === 'operator' ? 'operator' : 'policy'
        );
        return { created: true, id: request.requestId };
      })
      .immediate();
    return { created: outcome.created, payment: this.getPayment(outcome.id)! };
  }
  /** Re-runs every check that could have changed while chain reads were in flight. */
  checkBeforeSign(id: string): void {
    this.assertOwnership();
    const payment = this.paymentRow(id);
    const row = this.row(payment.mandate_id);
    if (payment.source === 'external-agent')
      assertMandateAuthorization(this.db, row.id, row.owner, 'execute_guarded_payment', this.now());
    const policy = JSON.parse(row.policy) as MandatePolicy;
    const chain = PAYMENT_CHAINS[this.config.paymentNetwork];
    if (policy.network !== chain.network || policy.mint !== chain.mint)
      throw new PolicyError('Runtime payment configuration differs from the frozen mandate.');
    if (
      payment.status !== 'reserved' ||
      (payment.signed_identity && (JSON.parse(payment.signed_identity) as SignedIdentity).phase !== 'signing')
    )
      throw new PolicyError('Payment cannot create another signature.');
    if (this.status(row, policy) !== 'active')
      throw new PolicyError('Mandate stopped or expired before signing.');
    if (!this.recipientAddresses(row.id).includes(payment.recipient))
      throw new PolicyError('Recipient is no longer on the mandate allowlist.');
    if (this.ledger.payerFrozen(id)) throw new PolicyError('Payer is held pending reconciliation.');
    const totals = this.amounts(row.id);
    if (
      totals.settled + totals.held > units(policy.ceiling) ||
      this.ledger.dailyUsed() > Math.min(this.config.dailyCeiling, units(policy.dailyCeiling))
    )
      throw new PolicyError('Ledger cap exceeded.');
  }
  markSigning(id: string, claim: SigningClaim) {
    this.db
      .transaction(() => {
        this.checkBeforeSign(id);
        const result = this.db
          .prepare(
            "UPDATE direct_payments SET signed_identity=? WHERE id=? AND status='reserved' AND signed_identity IS NULL"
          )
          .run(JSON.stringify({ ...claim, phase: 'signing' } satisfies SignedIdentity), id);
        if (result.changes !== 1) throw new PolicyError('Signing already claimed.');
        this.event(
          this.paymentRow(id).mandate_id,
          'signing',
          'Signature boundary entered',
          'Durable claim recorded before signer invocation.',
          'policy'
        );
      })
      .immediate();
  }
  markSigned(id: string, signed: { signature: string; wire: string }) {
    this.db
      .transaction(() => {
        const payment = this.paymentRow(id);
        const identity = payment.signed_identity
          ? (JSON.parse(payment.signed_identity) as SignedIdentity)
          : undefined;
        if (!identity || identity.phase !== 'signing' || payment.status !== 'reserved')
          throw new Error('Signing was not claimed.');
        this.db
          .prepare('UPDATE direct_payments SET signed_identity=?,signature=? WHERE id=?')
          .run(JSON.stringify({ ...identity, ...signed, phase: 'signed' } satisfies SignedIdentity), signed.signature, id);
      })
      .immediate();
  }
  markSubmitted(id: string) {
    this.db
      .transaction(() => {
        const payment = this.paymentRow(id);
        const identity = payment.signed_identity
          ? (JSON.parse(payment.signed_identity) as SignedIdentity)
          : undefined;
        if (!identity || identity.phase !== 'signed' || !heldStates.includes(payment.status))
          throw new Error('No persisted signed payment.');
        if (payment.status === 'submitted') return;
        this.db.prepare("UPDATE direct_payments SET status='submitted' WHERE id=?").run(id);
        this.event(
          payment.mandate_id,
          'submitted',
          'Payment submitted',
          'Signed transfer sent to the payment RPC. Settlement is not yet confirmed.'
        );
      })
      .immediate();
  }
  markUnknown(id: string, reason: string) {
    const payment = this.paymentRow(id);
    if (!heldStates.includes(payment.status) || payment.status === 'settlement-unknown') return;
    this.db
      .prepare("UPDATE direct_payments SET status='settlement-unknown',reason=? WHERE id=? AND status IN ('reserved','submitted')")
      .run(reason.slice(0, 500), id);
    this.event(
      payment.mandate_id,
      'held',
      'Settlement unknown',
      'Funds stay held and the payer cannot create new payments until evidence resolves this transfer.'
    );
  }
  markSettled(id: string, evidence: DirectSettlementEvidence) {
    this.db
      .transaction(() => {
        const payment = this.paymentRow(id);
        if (!heldStates.includes(payment.status) && !settledStates.includes(payment.status))
          throw new Error('Cannot settle an unreserved payment.');
        if (payment.signature && payment.signature !== evidence.signature)
          throw new Error('Settlement identity changed.');
        this.db
          .prepare(
            "UPDATE direct_payments SET status='settled',signature=?,chain_verified=1,evidence=?,reason=NULL,reason_code=NULL WHERE id=?"
          )
          .run(evidence.signature, JSON.stringify(evidence), id);
        if (!settledStates.includes(payment.status))
          this.event(
            payment.mandate_id,
            'settled',
            'Payment settled',
            `Trusted RPC confirmed the approved USDC movement in slot ${evidence.slot}.`
          );
      })
      .immediate();
  }
  /** Chain-proven non-settlement: the transaction landed with an error or its blockhash lapsed unused. */
  markNotSettled(id: string, status: 'failed' | 'expired', reason: string, evidence?: Record<string, unknown>) {
    this.db
      .transaction(() => {
        const payment = this.paymentRow(id);
        if (!heldStates.includes(payment.status)) return;
        this.db
          .prepare('UPDATE direct_payments SET status=?,reason=?,evidence=? WHERE id=?')
          .run(status, reason.slice(0, 500), evidence ? JSON.stringify(evidence) : null, id);
        this.event(
          payment.mandate_id,
          status,
          status === 'failed' ? 'Transfer failed on chain' : 'Transfer expired unlanded',
          `${reason} No USDC moved; the reserved amount is released.`
        );
      })
      .immediate();
  }
  releaseUnsigned(id: string, reason: string) {
    this.db
      .transaction(() => {
        const payment = this.paymentRow(id);
        if (payment.signed_identity) {
          this.markUnknown(id, reason);
          return;
        }
        this.db
          .prepare(
            "UPDATE direct_payments SET status='released',reason=? WHERE id=? AND status='reserved' AND signed_identity IS NULL"
          )
          .run(reason.slice(0, 500), id);
        this.event(
          payment.mandate_id,
          'released',
          'Unsigned reservation released',
          'No signing boundary was entered; held funds were released.',
          'policy'
        );
      })
      .immediate();
  }
  /** Held payments that still need chain evidence, with the signed bytes when they exist. */
  unresolved(): { id: string; identity: SignedIdentity; status: DirectPaymentStatus }[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM direct_payments WHERE status IN ('reserved','submitted','settlement-unknown') AND signed_identity IS NOT NULL"
      )
      .all() as PaymentRow[];
    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      identity: JSON.parse(row.signed_identity!) as SignedIdentity,
    }));
  }
  recoverStartup() {
    this.db
      .transaction(() => {
        this.db
          .prepare(
            "UPDATE direct_payments SET status='released',reason='Restart: provably never entered signing.' WHERE status='reserved' AND signed_identity IS NULL"
          )
          .run();
        this.db
          .prepare(
            "UPDATE direct_payments SET status='settlement-unknown',reason='Restart: signing or submission requires evidence.' WHERE status IN ('reserved','submitted') AND signed_identity IS NOT NULL"
          )
          .run();
      })
      .immediate();
  }
}
