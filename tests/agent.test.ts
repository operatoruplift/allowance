import { afterEach, expect, it, vi } from 'vitest';
import { openDatabase } from '../server/db/index.js';
import { loadConfig } from '../server/config.js';
import { Ledger } from '../server/policy/ledger.js';
import { AgentRunner, type ModelPort } from '../server/agent/runner.js';
import type { Response } from 'openai/resources/responses/responses';
const dbs: ReturnType<typeof openDatabase>[] = [];
afterEach(() => dbs.splice(0).forEach((db) => db.close()));
function setup(model: ModelPort) {
  const db = openDatabase(':memory:');
  dbs.push(db);
  const config = loadConfig({
    OPENAI_MODEL: 'controlled-test-model',
    MERCHANT_RECIPIENT: '11111111111111111111111111111111',
    LLM_MAX_CALLS: '2',
  });
  const ledger = new Ledger(db, config);
  const run = ledger.createRun({
    wallet: '11111111111111111111111111111111',
    task: 'Summarize the wallet.',
    allowance: '0.04',
    perRequestCap: '0.02',
    expiresInMinutes: 10,
    allowedTools: ['wallet_snapshot', 'transaction_explain'],
  });
  const paid = vi.fn().mockResolvedValue({});
  const runner = new AgentRunner(ledger, config, { runPaidTool: paid }, model);
  return { ledger, run, paid, runner };
}
async function untilDone(runner: AgentRunner) {
  await vi.waitFor(() => expect(runner.isBusy()).toBe(false));
}
it('rejects injected policy/URL arguments before the guarded paid client', async () => {
  let calls = 0;
  const model: ModelPort = {
    create: async () =>
      ++calls === 1
        ? ({
            output: [
              {
                type: 'function_call',
                id: 'fc_test',
                call_id: 'test',
                name: 'wallet_snapshot',
                arguments: JSON.stringify({
                  address: '11111111111111111111111111111111',
                  policy: { allowance: '999999' },
                  url: 'https://evil.example',
                }),
              },
            ],
            output_text: '',
            usage: undefined,
          } as Pick<Response, 'output' | 'output_text' | 'usage'>)
        : {
            output: [],
            output_text: 'Tool arguments were unavailable. No activity inferred.',
            usage: undefined,
          },
  };
  const { ledger, run, paid, runner } = setup(model);
  runner.start(run.id);
  await untilDone(runner);
  expect(paid).not.toHaveBeenCalled();
  expect(ledger.getRun(run.id).policy.allowance).toBe('40000');
  expect(ledger.getRun(run.id).settled).toBe('0');
  expect(ledger.getRun(run.id).llm.calls).toBe(2);
});
it('caps model calls and produces a recoverable report without a runaway loop', async () => {
  const model: ModelPort = {
    create: async () =>
      ({
        output: [
          {
            type: 'function_call',
            id: 'bad',
            call_id: 'bad',
            name: 'fetch_anything',
            arguments: '{}',
          },
        ],
        output_text: '',
        usage: undefined,
      }) as Pick<Response, 'output' | 'output_text' | 'usage'>,
  };
  const { ledger, run, paid, runner } = setup(model);
  runner.start(run.id);
  await untilDone(runner);
  expect(paid).not.toHaveBeenCalled();
  expect(ledger.getRun(run.id)).toMatchObject({ status: 'failed', llm: { calls: 2 } });
  expect(ledger.getRun(run.id).report).toContain('No paid tool result');
});
it('stopping an in-flight model call prevents further paid proposals', async () => {
  let started: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    started = resolve;
  });
  const model: ModelPort = {
    create: async (_params, signal) => {
      started();
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      );
    },
  };
  const { ledger, run, paid, runner } = setup(model);
  runner.start(run.id);
  await pending;
  runner.stop(run.id);
  await untilDone(runner);
  expect(paid).not.toHaveBeenCalled();
  expect(ledger.getRun(run.id).status).toBe('stopped');
});
it('runtime termination revokes an awaiting paid proposal before it can sign', async () => {
  const model: ModelPort = {
    create: async () =>
      ({
        output: [
          {
            type: 'function_call',
            id: 'fc',
            call_id: 'delayed',
            name: 'wallet_snapshot',
            arguments: JSON.stringify({ address: '11111111111111111111111111111111' }),
          },
        ],
        output_text: '',
        usage: undefined,
      }) as Pick<Response, 'output' | 'output_text' | 'usage'>,
  };
  const { ledger, run } = setup(model);
  ledger.config.maxRuntimeMs = 15;
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered: () => void = () => {};
  const enteredPromise = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let signatures = 0;
  const paid = {
    runPaidTool: async () => {
      entered();
      await pending;
      ledger.reserve({
        runId: run.id,
        requestId: 'delayed-purchase',
        canonicalHash: 'delayed-purchase',
        tool: 'wallet_snapshot',
        amount: '10000',
        origin: ledger.config.origin,
        path: '/merchant/wallet-snapshot',
        method: 'POST',
        recipient: run.policy.recipient,
        network: run.policy.network,
        mint: run.policy.mint,
      });
      signatures++;
      return {};
    },
  };
  const runner = new AgentRunner(ledger, ledger.config, paid, model);
  runner.start(run.id);
  await enteredPromise;
  await vi.waitFor(() => expect(ledger.getRun(run.id).status).toBe('failed'));
  release();
  await untilDone(runner);
  expect(signatures).toBe(0);
  expect(ledger.getRun(run.id).settled).toBe('0');
});
