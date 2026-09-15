import { decision } from '../shared/policy';
import {
  DEFAULT_TASK,
  PAYMENT_NETWORK,
  USDC_MINT,
  type RunDTO,
  type PurchaseDTO,
} from '../shared/domain';

export type DemoScenario = 'standard' | 'empty' | 'failure' | 'ambiguous';
const AT = '2026-09-12T00:00:00.000Z';
export function createDemo(): RunDTO {
  return {
    id: 'rehearsal',
    wallet: '11111111111111111111111111111111',
    task: DEFAULT_TASK,
    status: 'queued',
    mode: 'rehearsal',
    paymentNetwork: 'devnet',
    dataNetwork: 'devnet',
    createdAt: AT,
    policy: {
      version: 1,
      allowance: '40000',
      perRequestCap: '20000',
      dailyCeiling: '1000000',
      allowedTools: ['wallet_snapshot', 'transaction_explain'],
      origin: 'fixture://first-party',
      recipient: 'No recipient — rehearsal',
      network: PAYMENT_NETWORK,
      mint: USDC_MINT,
      expiresAt: '2026-09-12T00:15:00.000Z',
      callLimit: 3,
    },
    authorized: '40000',
    settled: '0',
    held: '0',
    remaining: '40000',
    purchases: [],
    events: [],
    report: null,
    error: null,
    llm: {
      provider: 'OpenAI',
      model: null,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      maxCalls: 0,
      maxOutputTokens: 0,
      note: 'No model is called in rehearsal. The decisions and data are deterministic fixtures.',
    },
  };
}
export function fixtureStep(previous: RunDTO, step: number, scenario: DemoScenario): RunDTO {
  const run: RunDTO = structuredClone(previous);
  const event = (title: string, detail: string, source: 'agent' | 'system' = 'agent') =>
    run.events.push({ id: run.events.length + 1, at: AT, kind: 'fixture', title, detail, source });
  const purchase = (tool: PurchaseDTO['tool'], amount: string, id: string): PurchaseDTO => ({
    id,
    tool,
    amount,
    status: 'reserved',
    createdAt: AT,
    chainVerified: false,
    serviceOutcome: 'pending',
    source: 'agent',
  });
  if (step === 0) {
    run.status = 'running';
    event(
      'Task received',
      'The fixture agent checks the permitted tools and 0.040000 USDC allowance.'
    );
  }
  if (step === 1) {
    run.purchases.push(purchase('wallet_snapshot', '10000', 'fixture-snapshot'));
    run.held = '10000';
    run.remaining = '30000';
    event(
      'Wallet snapshot reserved',
      'Fixture transition: 0.010000 is held while the simulated request is in progress.'
    );
  }
  if (step === 2) {
    if (scenario === 'failure') {
      run.purchases[0].status = 'released';
      run.purchases[0].serviceOutcome = 'unavailable';
      run.purchases[0].reason = 'Simulated provider unavailable before signing.';
      run.held = '0';
      run.remaining = '40000';
      run.status = 'failed';
      run.error =
        'Fixture service failure: the provider was unavailable before signing. The reservation was released; nothing was charged.';
      event(
        'Service unavailable',
        'Fixture: failure occurred before any signature. Reservation released.',
        'system'
      );
      return run;
    }
    if (scenario === 'ambiguous') {
      run.purchases[0].status = 'settlement-unknown';
      run.purchases[0].serviceOutcome = 'pending';
      run.purchases[0].deliveryState = 'pending';
      run.purchases[0].reason =
        'Simulated timeout after signing. The original intent remains held until reconciliation.';
      run.held = '10000';
      run.remaining = '30000';
      run.status = 'interrupted';
      run.error =
        'Fixture timeout after signing: settlement evidence is unknown. Reconcile the original intent; no second signature is created.';
      event(
        'Settlement unknown · held',
        'Fixture: the response timed out after signing. The original 0.010000 remains held for recovery.',
        'system'
      );
      return run;
    }
    run.purchases[0].status = 'delivered';
    run.purchases[0].serviceOutcome = 'delivered';
    run.purchases[0].result = {
      fixture: true,
      solBalance: scenario === 'empty' ? '0' : '1.250000000',
      recentTransactions:
        scenario === 'empty' ? [] : ['Fixture transaction 01', 'Fixture transaction 02'],
      provenance: 'Deterministic fixture; no RPC source.',
    };
    run.settled = '10000';
    run.held = '0';
    event(
      'Wallet snapshot delivered',
      scenario === 'empty'
        ? 'Fixture data: zero SOL and no transaction history. An empty wallet is a valid response.'
        : 'Fixture data: 1.25 SOL and two recent transaction entries.'
    );
    if (scenario === 'empty') {
      run.status = 'completed';
      run.report =
        'This deterministic fixture represents a wallet with no SOL balance and no recent transaction history. The wallet snapshot returned a valid empty result [wallet_snapshot].\n\nSkipped: transaction explanation, because there is no transaction to inspect. Rehearsal accounting: 0.010000 USDC simulated settled; 0.030000 remaining. No real payment, RPC request, or model call occurred.';
    }
  }
  if (step === 3) {
    run.purchases.push(purchase('transaction_explain', '20000', 'fixture-explanation'));
    run.held = '20000';
    run.remaining = '10000';
    event(
      'Transaction explanation reserved',
      'Fixture transition: 0.020000 is held inside the per-request cap.'
    );
  }
  if (step === 4) {
    run.purchases[1].status = 'delivered';
    run.purchases[1].serviceOutcome = 'delivered';
    run.purchases[1].result = {
      fixture: true,
      transaction: 'Fixture transaction 01',
      success: true,
      feeSol: '0.000005000',
      recognizedInstructions: ['System Program: SOL transfer'],
      transferSol: '0.025000000',
      provenance: 'Deterministic fixture; no chain signature.',
    };
    run.settled = '30000';
    run.held = '0';
    event(
      'Transaction explanation delivered',
      'Fixture data: a successful 0.025 SOL transfer with a 0.000005 SOL fee.'
    );
  }
  if (step === 5) {
    run.status = 'completed';
    event(
      'Brief completed',
      'The fixture agent skips another 0.020000 tool call because only 0.010000 remains. No denied call is invented in the agent trace.'
    );
    run.report =
      'The example wallet holds 1.25 SOL and has two recent transaction entries [wallet_snapshot].\n\nIts latest transaction is a successful System Program transfer of 0.025 SOL, with a 0.000005 SOL transaction fee [transaction_explain]. The fixture supplies no identity or intent behind the transfer.\n\nSkipped: the second transaction explanation costs 0.020000 USDC, above the 0.010000 remaining allowance.\n\nAll facts and payment transitions above are deterministic fixtures. No RPC, model, signing, or paid request occurred.';
  }
  return run;
}
export function demoProbe(previous: RunDTO): RunDTO {
  const run = structuredClone(previous);
  const outcome = decision(
    {
      policy: run.policy,
      status: run.status === 'completed' ? 'running' : run.status,
      settled: Number(run.settled),
      held: Number(run.held),
      dailyUsed: Number(run.settled) + Number(run.held),
      dailyCeiling: Number(run.policy.dailyCeiling),
      calls: run.purchases.filter((p) => p.source === 'agent').length,
      payerFrozen: false,
      now: Date.parse(AT) + 1000,
    },
    {
      runId: run.id,
      requestId: 'fixture-policy-probe',
      canonicalHash: 'fixture-policy-probe',
      tool: 'transaction_explain',
      amount: '20000',
      origin: run.policy.origin,
      path: '/merchant/transaction-explain',
      method: 'POST',
      recipient: run.policy.recipient,
      network: run.policy.network,
      mint: run.policy.mint,
      source: 'policy-probe',
    }
  );
  if (outcome.allowed) {
    run.events.push({
      id: run.events.length + 1,
      at: AT,
      kind: 'probe',
      title: 'Policy probe would fit',
      detail: 'Same pure policy decision as the backend. No fixture or real purchase was made.',
      source: 'policy-probe',
    });
    return run;
  }
  run.purchases.push({
    id: 'fixture-policy-probe',
    tool: 'transaction_explain',
    amount: '20000',
    status: 'denied',
    createdAt: AT,
    reason: outcome.reason,
    chainVerified: false,
    serviceOutcome: 'unavailable',
    source: 'policy-probe',
  });
  run.events.push({
    id: run.events.length + 1,
    at: AT,
    kind: 'denied',
    title: 'Policy probe denied before signing',
    detail:
      'Same policy decision as the backend, using deterministic inputs: 0.020000 exceeds 0.010000 remaining. No reservation or signature created. Agent trace is unchanged.',
    source: 'policy-probe',
  });
  return run;
}

export function reconcileDemo(previous: RunDTO): RunDTO {
  const run = structuredClone(previous);
  const purchase = run.purchases.find((item) => item.status === 'settlement-unknown');
  if (!purchase) return run;
  purchase.status = 'settled-but-result-unavailable';
  purchase.serviceOutcome = 'unavailable';
  purchase.deliveryState = 'unavailable';
  purchase.reason =
    'Fixture reconciliation recovered the original settlement report. No second signature was created and no paid result was delivered.';
  run.settled = '10000';
  run.held = '0';
  run.remaining = '30000';
  run.status = 'interrupted';
  run.error =
    'Fixture recovery completed with settlement reported but delivery unavailable. The original hold was reconciled without a second signature.';
  run.events.push({
    id: run.events.length + 1,
    at: AT,
    kind: 'recovery',
    title: 'Original hold reconciled',
    detail:
      'Fixture recovery checked the original intent and cleared the hold without creating a second signature. Delivery remains unavailable.',
    source: 'system',
  });
  run.report =
    'The wallet snapshot entered a deterministic settlement-unknown state after a simulated timeout. Reconciliation recovered the original settlement report and cleared 0.010000 USDC from held to settled without retrying the payment.\n\nThe paid result was unavailable, so no wallet facts are inferred. This is a deterministic recovery fixture with no RPC, signing, or paid request.';
  return run;
}
