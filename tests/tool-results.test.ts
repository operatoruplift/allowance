import { expect, it } from 'vitest';
import { snapshotIncludesSignature, validateToolResult } from '../shared/tool-results.js';
import type { RunDTO } from '../shared/domain.js';
import { snapshotFixture, explanationFixture } from './fixtures/tool-results.js';
const wallet = '11111111111111111111111111111111';
const signature = '1'.repeat(64);

it('accepts schema-valid bounded RPC facts and rejects wrong identity, network and inconsistent totals', () => {
  const snapshot = snapshotFixture(wallet, [signature]);
  expect(validateToolResult('wallet_snapshot', snapshot, { address: wallet }, 'mainnet')).toEqual(
    snapshot
  );
  expect(() =>
    validateToolResult('wallet_snapshot', snapshot, { address: wallet }, 'devnet')
  ).toThrow(/network/);
  expect(() =>
    validateToolResult('wallet_snapshot', { ...snapshot, balanceSol: '999.0' }, { address: wallet })
  ).toThrow();
  expect(() =>
    validateToolResult(
      'wallet_snapshot',
      { ...snapshot, arbitrary: 'untrusted' },
      { address: wallet }
    )
  ).toThrow();
  const explanation = explanationFixture(signature, wallet);
  expect(validateToolResult('transaction_explain', explanation, { signature })).toEqual(
    explanation
  );
  expect(() =>
    validateToolResult('transaction_explain', explanation, { signature: 'other' })
  ).toThrow(/identity/);
});

it('permits explanation membership only from the validated recent-signatures field of a delivered snapshot', () => {
  const snapshot = snapshotFixture(wallet);
  snapshot.limitations = [signature];
  const run = {
    wallet,
    dataNetwork: 'mainnet',
    purchases: [
      {
        tool: 'wallet_snapshot',
        serviceOutcome: 'delivered',
        result: snapshot,
      },
    ],
  } as RunDTO;
  expect(snapshotIncludesSignature(run, signature)).toBe(false);
  run.purchases[0].result = snapshotFixture(wallet, [signature]);
  expect(snapshotIncludesSignature(run, signature)).toBe(true);
  run.purchases[0].serviceOutcome = 'unavailable';
  expect(snapshotIncludesSignature(run, signature)).toBe(false);
});
