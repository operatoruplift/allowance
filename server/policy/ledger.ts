import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  CATALOG,
  PAYMENT_NETWORK,
  USDC_MINT,
  parseMoney,
  units,
  type CreateRunInput,
  type Policy,
  type RunDTO,
  type PurchaseDTO,
  type EventDTO,
} from '../../shared/domain.js';
import type { Config } from '../config.js';
import type {
  PaymentLedger,
  PaymentIntent,
  PurchaseProposal,
  SigningEvidence,
  SignedEvidence,
  SettlementEvidence,
} from '../payments/contracts.js';
import { decision, PolicyError } from './decision.js';
interface RunRow {
  id: string;
  owner: string;
  wallet: string;
  task: string;
  status: RunDTO['status'];
  policy: string;
  created_at: string;
  data_network: RunDTO['dataNetwork'];
  report: string | null;
  error: string | null;
  llm_calls: number;
  input_tokens: number;
  output_tokens: number;
  execution_mode: 'builtin' | 'external';
}
interface IntentRow {
  id: string;
  run_id: string;
  request_hash: string;
  tool: PurchaseDTO['tool'];
  amount: number;
  status: PurchaseDTO['status'];
  created_at: string;
  day: string;
  source: PurchaseDTO['source'];
  reason: string | null;
  signed_identity: string | null;
  signature: string | null;
  chain_verified: number;
  result: string | null;
  service_outcome: PurchaseDTO['serviceOutcome'];
  payload: string | null;
  evidence: string | null;
  recovery_attempts: number;
}
const settledStates = ['settled', 'delivered', 'settled-but-result-unavailable'];
const heldStates = ['reserved', 'submitted', 'settlement-unknown'];
function resultHash(result: unknown) {
  return createHash('sha256').update(JSON.stringify(result), 'utf8').digest('hex');
}
export class Ledger implements PaymentLedger {
  constructor(
    public db: Database.Database,
    public config: Config,
    private now: () => number = Date.now,
    private assertOwnership: () => void = () => {}
  ) {}
  private time() {
    return new Date(this.now()).toISOString();
  }
  private runRow(id: string): RunRow {
    const row = this.db.prepare('SELECT * FROM runs WHERE id=?').get(id) as RunRow | undefined;
    if (!row) throw new Error('Run not found.');
    return row;
  }
  private intentRow(id: string): IntentRow {
    const row = this.db.prepare('SELECT * FROM intents WHERE id=?').get(id) as
      IntentRow | undefined;
    if (!row) throw new Error('Payment intent not found.');
    return row;
  }
  private rows(runId: string) {
    return this.db
      .prepare('SELECT * FROM intents WHERE run_id=? ORDER BY created_at,id')
      .all(runId) as IntentRow[];
  }
  private amounts(runId: string) {
    const rows = this.rows(runId);
    return {
      settled: rows
        .filter((r) => settledStates.includes(r.status))
        .reduce((s, r) => s + r.amount, 0),
      held: rows.filter((r) => heldStates.includes(r.status)).reduce((s, r) => s + r.amount, 0),
      calls: rows.filter((r) => !['denied', 'released'].includes(r.status) && r.source === 'agent')
        .length,
    };
  }
  dailyUsed() {
    const day = this.time().slice(0, 10);
    const rows = this.db.prepare('SELECT amount,status,day FROM intents').all() as Pick<
      IntentRow,
      'amount' | 'status' | 'day'
    >[];
    return rows.reduce(
      (sum, row) =>
        sum +
        (heldStates.includes(row.status) || (settledStates.includes(row.status) && row.day === day)
          ? row.amount
          : 0),
      0
    );
  }
  payerFrozen(exclude?: string) {
    const rows = this.db
      .prepare(
        "SELECT id,status,signed_identity FROM intents WHERE status IN ('reserved','submitted','settlement-unknown')"
      )
      .all() as IntentRow[];
    return rows.some((r) => r.id !== exclude && (r.status !== 'reserved' || !!r.signed_identity));
  }
  event(
    runId: string,
    kind: string,
    title: string,
    detail: string,
    source: EventDTO['source'] = 'system'
  ) {
    this.db
      .prepare('INSERT INTO events(run_id,at,kind,title,detail,source) VALUES(?,?,?,?,?,?)')
      .run(runId, this.time(), kind, title, detail.slice(0, 4000), source);
  }
  createRun(
    input: CreateRunInput,
    owner = 'operator',
    executionMode: 'builtin' | 'external' = 'builtin'
  ): RunDTO {
    this.assertOwnership();
    const allowance = parseMoney(input.allowance);
    const cap = parseMoney(input.perRequestCap);
    if (allowance > this.config.maxAllowance || allowance > this.config.dailyCeiling)
      throw new PolicyError('Allowance exceeds the configured run or daily maximum.');
    if (cap > allowance) throw new PolicyError('Per-request maximum cannot exceed allowance.');
    const id = randomUUID();
    const policy: Policy = {
      version: 1,
      allowance: String(allowance),
      perRequestCap: String(cap),
      dailyCeiling: String(this.config.dailyCeiling),
      allowedTools: input.allowedTools,
      origin: this.config.origin,
      recipient: this.config.recipient,
      network: PAYMENT_NETWORK,
      mint: USDC_MINT,
      expiresAt: new Date(this.now() + input.expiresInMinutes * 60000).toISOString(),
      runtimeExpiresAt: new Date(this.now() + this.config.maxRuntimeMs).toISOString(),
      callLimit: 4,
    };
    this.db
      .transaction(() => {
        if (this.payerFrozen()) throw new PolicyError('Payer is held pending reconciliation.');
        const active = this.db
          .prepare("SELECT count(*) AS n FROM runs WHERE status IN ('queued','running')")
          .get() as { n: number };
        if (active.n >= 1)
          throw new PolicyError('One run is already active. Stop it or wait for completion.');
        this.db
          .prepare(
            'INSERT INTO runs(id,owner,wallet,task,status,policy,created_at,data_network,execution_mode) VALUES(?,?,?,?,?,?,?,?,?)'
          )
          .run(
            id,
            owner,
            input.wallet,
            input.task,
            'queued',
            JSON.stringify(policy),
            this.time(),
            this.config.dataNetwork,
            executionMode
          );
        this.event(
          id,
          'authorization',
          'Allowance authorized',
          `${input.allowance} devnet USDC. Policy version 1 is immutable.`,
          'policy'
        );
      })
      .immediate();
    return this.getRun(id, owner);
  }
  getRun(id: string, owner = 'operator'): RunDTO {
    const run = this.runRow(id);
    if (run.owner !== owner) throw new Error('Run not found.');
    const policy = JSON.parse(run.policy) as Policy;
    const amounts = this.amounts(id);
    const purchases = this.rows(id).map((row): PurchaseDTO => {
      const signed = row.signed_identity ? JSON.parse(row.signed_identity) : undefined;
      const evidence = row.evidence ? JSON.parse(row.evidence) : undefined;
      return {
        id: row.id,
        tool: row.tool,
        amount: String(row.amount),
        status: row.status,
        createdAt: row.created_at,
        reason: row.reason || undefined,
        signature: row.signature || undefined,
        chainVerified: row.chain_verified === 1,
        result: row.result ? JSON.parse(row.result) : undefined,
        source: row.source,
        serviceOutcome: row.service_outcome,
        payer: signed?.payer,
        recipient: policy.recipient,
        feeSponsor: evidence?.feeSponsor,
        feeLamports: evidence?.feeLamports,
        originalBlockhash: evidence?.originalBlockhash || signed?.blockhash,
        originatingLastValidBlockHeight: evidence?.originatingLastValidBlockHeight,
        proofObservedAt: evidence?.proofObservedAt,
        deliveryState:
          evidence?.deliveryState ||
          (row.service_outcome === 'delivered'
            ? 'delivered'
            : row.service_outcome === 'unavailable'
              ? 'unavailable'
              : 'pending'),
        resultHash: evidence?.resultHash,
      };
    });
    const events = this.db
      .prepare('SELECT id,at,kind,title,detail,source FROM events WHERE run_id=? ORDER BY id')
      .all(id) as EventDTO[];
    return {
      id: run.id,
      wallet: run.wallet,
      task: run.task,
      status: run.status,
      mode: 'live',
      executionMode: run.execution_mode,
      paymentNetwork: 'devnet',
      dataNetwork: run.data_network,
      createdAt: run.created_at,
      policy,
      authorized: policy.allowance,
      settled: String(amounts.settled),
      held: String(amounts.held),
      remaining: String(units(policy.allowance) - amounts.settled - amounts.held),
      purchases,
      events,
      report: run.report,
      error: run.error,
      llm: {
        provider: 'OpenAI',
        model: this.config.openaiModel || null,
        calls: run.llm_calls,
        inputTokens: run.input_tokens,
        outputTokens: run.output_tokens,
        maxCalls: this.config.maxLlmCalls,
        maxOutputTokens: this.config.maxLlmOutputTokens,
        note: 'LLM-provider usage is billed separately, outside the USDC allowance.',
      },
    };
  }
  listRuns(owner = 'operator') {
    return (
      this.db
        .prepare('SELECT id FROM runs WHERE owner=? ORDER BY created_at DESC LIMIT 30')
        .all(owner) as { id: string }[]
    ).map((r) => this.getRun(r.id, owner));
  }
  setStatus(id: string, status: RunDTO['status'], error: string | null = null) {
    this.db
      .prepare(
        "UPDATE runs SET status=?,error=? WHERE id=? AND status NOT IN ('stopped','expired')"
      )
      .run(status, error, id);
  }
  setReport(id: string, report: string) {
    this.db.prepare('UPDATE runs SET report=? WHERE id=?').run(report.slice(0, 20000), id);
  }
  claimLlmCall(id: string): void {
    this.db
      .transaction(() => {
        const run = this.runRow(id);
        const policy = JSON.parse(run.policy) as Policy;
        if (
          !['running', 'queued'].includes(run.status) ||
          this.now() >= Date.parse(policy.expiresAt)
        )
          throw new PolicyError('Run stopped or expired.');
        if (run.llm_calls >= this.config.maxLlmCalls)
          throw new PolicyError('LLM-provider call cap reached.');
        this.db.prepare('UPDATE runs SET llm_calls=llm_calls+1 WHERE id=?').run(id);
      })
      .immediate();
  }
  addUsage(id: string, input: number, output: number) {
    if (!Number.isSafeInteger(input) || input < 0 || !Number.isSafeInteger(output) || output < 0)
      throw new Error('Invalid usage.');
    this.db
      .prepare(
        'UPDATE runs SET input_tokens=input_tokens+?,output_tokens=output_tokens+? WHERE id=?'
      )
      .run(input, output, id);
  }
  revokeRuntime(id: string) {
    this.db
      .transaction(() => {
        const changed = this.db
          .prepare(
            "UPDATE runs SET status='failed',error='Agent runtime bound reached. No new signatures are permitted.' WHERE id=? AND status IN ('queued','running')"
          )
          .run(id);
        this.db
          .prepare(
            "UPDATE intents SET status='released',reason='Runtime expired before signing.' WHERE run_id=? AND status='reserved' AND signed_identity IS NULL"
          )
          .run(id);
        if (changed.changes)
          this.event(
            id,
            'runtime-expired',
            'Runtime limit reached',
            'Unsigned reservations released. Signed purchases retain their settlement state.',
            'policy'
          );
      })
      .immediate();
  }
  stop(id: string, owner = 'operator') {
    this.getRun(id, owner);
    this.db
      .transaction(() => {
        this.db
          .prepare(
            "UPDATE runs SET status='stopped' WHERE id=? AND status IN ('queued','running','interrupted')"
          )
          .run(id);
        this.db
          .prepare(
            "UPDATE intents SET status='released',reason='Run stopped before signing.' WHERE run_id=? AND status='reserved' AND signed_identity IS NULL"
          )
          .run(id);
        this.event(
          id,
          'stop',
          'Stop requested',
          'No new signatures. Previously signed or submitted purchases remain visible and may settle.',
          'policy'
        );
      })
      .immediate();
    return this.getRun(id, owner);
  }
  reserve(proposal: PurchaseProposal): { created: boolean; intent: PaymentIntent } {
    const outcome = this.db
      .transaction(() => {
        this.assertOwnership();
        const existing = this.db
          .prepare('SELECT * FROM intents WHERE id=? OR (run_id=? AND request_hash=?)')
          .get(proposal.requestId, proposal.runId, proposal.canonicalHash) as IntentRow | undefined;
        if (existing) {
          if (
            existing.run_id !== proposal.runId ||
            existing.request_hash !== proposal.canonicalHash ||
            existing.tool !== proposal.tool ||
            String(existing.amount) !== proposal.amount
          )
            throw new PolicyError('Idempotency ID conflicts with a different request.');
          return { created: false, intent: this.toIntent(existing) };
        }
        const run = this.runRow(proposal.runId);
        const policy = JSON.parse(run.policy) as Policy;
        const amounts = this.amounts(run.id);
        const result = decision(
          {
            policy,
            status: run.status,
            ...amounts,
            dailyUsed: this.dailyUsed(),
            dailyCeiling: this.config.dailyCeiling,
            payerFrozen: this.payerFrozen(),
            now: this.now(),
          },
          proposal
        );
        const amount = (() => {
          try {
            return units(proposal.amount);
          } catch {
            return 0;
          }
        })();
        this.db
          .prepare(
            'INSERT INTO intents(id,run_id,request_hash,tool,amount,status,created_at,day,source,reason) VALUES(?,?,?,?,?,?,?,?,?,?)'
          )
          .run(
            proposal.requestId,
            run.id,
            proposal.canonicalHash,
            proposal.tool,
            amount,
            result.allowed ? 'reserved' : 'denied',
            this.time(),
            this.time().slice(0, 10),
            proposal.source || 'agent',
            result.reason
          );
        this.event(
          run.id,
          result.allowed ? 'reserved' : 'denied',
          result.allowed ? 'Funds reserved' : 'Request blocked',
          result.reason,
          proposal.source === 'policy-probe' ? 'policy-probe' : 'policy'
        );
        return result.allowed
          ? { created: true, intent: this.getIntent(proposal.requestId)! }
          : { error: result.reason };
      })
      .immediate();
    if ('error' in outcome) throw new PolicyError(outcome.error);
    return outcome;
  }
  checkBeforeSign(id: string): void {
    this.assertOwnership();
    const intent = this.intentRow(id);
    const run = this.runRow(intent.run_id);
    const policy = JSON.parse(run.policy) as Policy;
    if (
      intent.status !== 'reserved' ||
      (intent.signed_identity && JSON.parse(intent.signed_identity).phase !== 'signing')
    )
      throw new PolicyError('Intent cannot create another signature.');
    if (
      !['queued', 'running'].includes(run.status) ||
      this.now() >= Date.parse(policy.expiresAt) ||
      (policy.runtimeExpiresAt && this.now() >= Date.parse(policy.runtimeExpiresAt))
    )
      throw new PolicyError('Run stopped or policy expired before signing.');
    if (this.payerFrozen(id)) throw new PolicyError('Payer is held pending reconciliation.');
    const totals = this.amounts(run.id);
    if (
      totals.settled + totals.held > units(policy.allowance) ||
      this.dailyUsed() > Math.min(this.config.dailyCeiling, units(policy.dailyCeiling))
    )
      throw new PolicyError('Ledger cap exceeded.');
  }
  markSigning(id: string, evidence: SigningEvidence) {
    this.db
      .transaction(() => {
        this.checkBeforeSign(id);
        const result = this.db
          .prepare(
            "UPDATE intents SET signed_identity=? WHERE id=? AND status='reserved' AND signed_identity IS NULL"
          )
          .run(JSON.stringify({ ...evidence, phase: 'signing' }), id);
        if (result.changes !== 1) throw new PolicyError('Signing already claimed.');
        this.event(
          this.intentRow(id).run_id,
          'signing',
          'Signature boundary entered',
          'Durable claim recorded before signer invocation.',
          'policy'
        );
      })
      .immediate();
  }
  markSigned(id: string, evidence: SignedEvidence) {
    this.db
      .transaction(() => {
        const intent = this.intentRow(id);
        if (
          !intent.signed_identity ||
          JSON.parse(intent.signed_identity).phase !== 'signing' ||
          intent.status !== 'reserved'
        )
          throw new Error('Signing was not claimed.');
        this.db
          .prepare('UPDATE intents SET signed_identity=?,payload=? WHERE id=?')
          .run(
            JSON.stringify({ ...evidence, payload: undefined, phase: 'signed' }),
            JSON.stringify(evidence.payload),
            id
          );
      })
      .immediate();
  }
  markSubmitted(id: string) {
    this.db
      .transaction(() => {
        const intent = this.intentRow(id);
        if (
          !intent.signed_identity ||
          JSON.parse(intent.signed_identity).phase !== 'signed' ||
          !['reserved', 'submitted', 'settlement-unknown'].includes(intent.status)
        )
          throw new Error('No persisted signed payment.');
        this.db.prepare("UPDATE intents SET status='submitted' WHERE id=?").run(id);
        this.event(
          intent.run_id,
          'submitted',
          'Payment submitted',
          'Paid HTTP retry submitted to the first-party merchant. Settlement is not yet confirmed.'
        );
      })
      .immediate();
  }
  markUnknown(id: string, reason: string) {
    const intent = this.intentRow(id);
    if (settledStates.includes(intent.status)) return;
    this.db
      .prepare(
        "UPDATE intents SET status='settlement-unknown',reason=? WHERE id=? AND status IN ('reserved','submitted','settlement-unknown')"
      )
      .run(reason.slice(0, 500), id);
    this.event(
      intent.run_id,
      'held',
      'Settlement unknown',
      'Funds stay held and the payer cannot create new payments until evidence resolves this purchase.'
    );
  }
  markSettled(id: string, evidence: SettlementEvidence) {
    this.db
      .transaction(() => {
        const intent = this.intentRow(id);
        if (!heldStates.includes(intent.status) && !settledStates.includes(intent.status))
          throw new Error('Cannot settle an unreserved intent.');
        if (intent.signature && intent.signature !== evidence.signature)
          throw new Error('Settlement identity changed.');
        const signed = intent.signed_identity ? JSON.parse(intent.signed_identity) : undefined;
        const observed: SettlementEvidence = {
          ...evidence,
          proofObservedAt: evidence.proofObservedAt ?? new Date(this.now()).toISOString(),
          originalBlockhash: evidence.originalBlockhash ?? signed?.blockhash,
          deliveryState: intent.service_outcome,
        };
        this.db
          .prepare(
            "UPDATE intents SET status=CASE WHEN status IN ('delivered','settled-but-result-unavailable') THEN status ELSE 'settled' END,signature=?,chain_verified=MAX(chain_verified,?),evidence=?,day=?,reason=NULL WHERE id=?"
          )
          .run(
            observed.signature,
            observed.chainVerified ? 1 : 0,
            JSON.stringify(observed),
            settledStates.includes(intent.status) ? intent.day : this.time().slice(0, 10),
            id
          );
        if (!settledStates.includes(intent.status))
          this.event(
            intent.run_id,
            'settled',
            'Payment settled',
            observed.chainVerified
              ? 'Trusted RPC confirmed the approved USDC movement.'
              : 'Facilitator reports settlement. Independent chain verification remains pending.'
          );
      })
      .immediate();
  }
  markDelivered(id: string, result: unknown) {
    const intent = this.intentRow(id);
    if (!settledStates.includes(intent.status))
      throw new Error('Delivery requires settlement evidence.');
    const json = JSON.stringify(result);
    if (json.length > 100000) throw new Error('Result exceeds storage bound.');
    const evidence = intent.evidence ? JSON.parse(intent.evidence) : {};
    this.db
      .transaction(() => {
        this.db
          .prepare(
            "UPDATE intents SET status='delivered',result=?,service_outcome='delivered' WHERE id=?"
          )
          .run(json, id);
        this.db
          .prepare('UPDATE intents SET evidence=? WHERE id=?')
          .run(
            JSON.stringify({
              ...evidence,
              deliveryState: 'delivered',
              resultHash: resultHash(result),
            }),
            id
          );
      })
      .immediate();
    this.event(
      intent.run_id,
      'delivered',
      'Tool result received',
      `${intent.tool} returned data. Payment does not establish the quality of that data.`,
      'agent'
    );
  }
  markResultUnavailable(id: string, reason: string) {
    const intent = this.intentRow(id);
    if (!settledStates.includes(intent.status)) {
      this.markUnknown(id, reason);
      return;
    }
    const evidence = intent.evidence ? JSON.parse(intent.evidence) : {};
    this.db
      .transaction(() => {
        this.db
          .prepare(
            "UPDATE intents SET status='settled-but-result-unavailable',service_outcome='unavailable',reason=? WHERE id=?"
          )
          .run(reason.slice(0, 500), id);
        this.db
          .prepare('UPDATE intents SET evidence=? WHERE id=?')
          .run(JSON.stringify({ ...evidence, deliveryState: 'unavailable' }), id);
      })
      .immediate();
    this.event(
      intent.run_id,
      'unavailable',
      'Paid result unavailable',
      'Payment settled. Delivery failed; recovery can reuse the same payment identity.'
    );
  }
  rejectUnsigned(id: string, reason: string) {
    this.db
      .transaction(() => {
        const intent = this.intentRow(id);
        if (intent.signed_identity) {
          this.markUnknown(id, reason);
          return;
        }
        this.db
          .prepare(
            "UPDATE intents SET status='released',reason=? WHERE id=? AND status='reserved' AND signed_identity IS NULL"
          )
          .run(reason.slice(0, 500), id);
        this.event(
          intent.run_id,
          'released',
          'Unsigned reservation released',
          'No signing boundary was entered; held funds were released.',
          'policy'
        );
      })
      .immediate();
  }
  private toIntent(row: IntentRow): PaymentIntent {
    return {
      id: row.id,
      runId: row.run_id,
      requestId: row.id,
      canonicalHash: row.request_hash,
      tool: row.tool,
      amount: String(row.amount),
      status: row.status,
      result: row.result ? JSON.parse(row.result) : undefined,
      signature: row.signature || undefined,
    };
  }
  findIntentByHash(runId: string, hash: string): PaymentIntent | undefined {
    const row = this.db
      .prepare('SELECT * FROM intents WHERE run_id=? AND request_hash=?')
      .get(runId, hash) as IntentRow | undefined;
    return row ? this.toIntent(row) : undefined;
  }
  getIntent(id: string): PaymentIntent | undefined {
    const row = this.db.prepare('SELECT * FROM intents WHERE id=?').get(id) as
      IntentRow | undefined;
    return row ? this.toIntent(row) : undefined;
  }
  recoverStartup() {
    this.db
      .transaction(() => {
        this.db
          .prepare(
            "UPDATE intents SET status='released',reason='Restart: provably never entered signing.' WHERE status='reserved' AND signed_identity IS NULL"
          )
          .run();
        this.db
          .prepare(
            "UPDATE intents SET status='settlement-unknown',reason='Restart: signing/submission requires evidence.' WHERE status IN ('reserved','submitted') AND signed_identity IS NOT NULL"
          )
          .run();
        const runs = this.db
          .prepare("SELECT id FROM runs WHERE status IN ('queued','running')")
          .all() as { id: string }[];
        for (const run of runs) {
          this.db
            .prepare(
              "UPDATE runs SET status='interrupted',error='Service restarted. Existing purchases can reconcile; authorize a new run to spend again.' WHERE id=?"
            )
            .run(run.id);
          this.event(
            run.id,
            'recovery',
            'Run recovered after restart',
            'Observation restored. Old authorization is not restarted.'
          );
        }
        this.db.prepare('DELETE FROM sessions WHERE expires<=?').run(this.now());
      })
      .immediate();
  }
  probe(id: string): RunDTO {
    this.db
      .transaction(() => {
        const run = this.getRun(id);
        if (run.purchases.some((p) => p.source === 'policy-probe')) return;
        const tool = CATALOG[1];
        const proposal: PurchaseProposal = {
          runId: id,
          requestId: randomUUID(),
          canonicalHash: `policy-probe:${id}`,
          tool: tool.name,
          amount: tool.price,
          origin: run.policy.origin,
          path: tool.path,
          method: 'POST',
          recipient: run.policy.recipient,
          network: run.policy.network,
          mint: run.policy.mint,
          source: 'policy-probe',
        };
        const outcome = decision(
          {
            policy: run.policy,
            status: run.status === 'completed' ? 'running' : run.status,
            ...this.amounts(id),
            dailyUsed: this.dailyUsed(),
            dailyCeiling: this.config.dailyCeiling,
            payerFrozen: this.payerFrozen(),
            now: this.now(),
          },
          proposal
        );
        if (outcome.allowed) {
          this.event(
            id,
            'probe',
            'Policy probe allowed',
            'This read-only probe would fit the current policy. No signing or purchase was attempted.',
            'policy-probe'
          );
          return;
        }
        this.db
          .prepare(
            "INSERT INTO intents(id,run_id,request_hash,tool,amount,status,created_at,day,source,reason) VALUES(?,?,?,?,?,'denied',?,?,'policy-probe',?)"
          )
          .run(
            proposal.requestId,
            id,
            proposal.canonicalHash,
            tool.name,
            units(tool.price),
            this.time(),
            this.time().slice(0, 10),
            outcome.reason
          );
        this.event(
          id,
          'denied',
          'Policy probe blocked',
          `${outcome.reason} A separate policy probe; no signer was invoked.`,
          'policy-probe'
        );
      })
      .immediate();
    return this.getRun(id);
  }
}
