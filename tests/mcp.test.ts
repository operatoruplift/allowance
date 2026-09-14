import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { InMemoryTransport as ServerInMemoryTransport } from '@modelcontextprotocol/server';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAgentGrant, revokeSessionAgentGrants } from '../server/mcp/grants.js';
import { openDatabase } from '../server/db/index.js';
import { loadConfig } from '../server/config.js';
import { Ledger } from '../server/policy/ledger.js';
import { createAllowanceMcpServer } from '../server/mcp.js';

const runtimes: Array<{ close(): void }> = [];
const tempDirs: string[] = [];

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.close();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function setup() {
  const config = loadConfig({
    MCP_ENABLED: 'true',
    LIVE_PAYMENTS_ENABLED: 'false',
    MERCHANT_RECIPIENT: '11111111111111111111111111111111',
  });
  const db = openDatabase(':memory:');
  const ledger = new Ledger(db, config);
  const run = ledger.createRun(
    {
      wallet: '11111111111111111111111111111111',
      task: 'Explain this wallet activity.',
      allowance: '0.04',
      perRequestCap: '0.02',
      expiresInMinutes: 10,
      allowedTools: ['wallet_snapshot', 'transaction_explain'],
    },
    'operator',
    'external'
  );
  ledger.setStatus(run.id, 'running');
  const created = createAgentGrant(db, ledger, {
    runId: run.id,
    owner: 'operator',
    sessionId: 'test-session',
    expiresAt: run.policy.expiresAt,
  });
  const runtime = {
    config,
    db,
    ledger,
    data: undefined,
    payments: {
      runPaidTool: async () => {
        throw new Error('not reached');
      },
      reconcile: async () => {},
      readiness: async () => ({
        ready: false,
        items: [],
        payer: null,
        balance: { usdc: null, sol: null },
      }),
      mountMerchant: () => {},
    },
    runner: null,
    close() {
      db.close();
    },
  } as never;
  runtimes.push(runtime);
  return { db, ledger, run, token: created.token, runtime };
}

async function connect(runtime: never, token: string) {
  const server = createAllowanceMcpServer(runtime, token);
  const [serverTransport, clientTransport] = ServerInMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'allowance-test-client', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { server, client };
}

describe('Allowance local MCP bridge', () => {
  it('discovers only the fixed tools and returns safe payment errors', async () => {
    const { run, token, runtime } = await setup();
    const { server, client } = await connect(runtime, token);
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      'wallet_snapshot',
      'transaction_explain',
      'get_run_status',
      'get_receipt',
      'stop_run',
    ]);
    const walletTool = listed.tools.find((tool) => tool.name === 'wallet_snapshot');
    expect(walletTool?.inputSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['runId', 'requestId'],
    });
    const status = await client.callTool({
      name: 'get_run_status',
      arguments: { runId: run.id },
    });
    expect(status.isError).not.toBe(true);
    expect(status.structuredContent).toMatchObject({ runId: run.id, executionMode: 'external' });
    const payment = await client.callTool({
      name: 'wallet_snapshot',
      arguments: { runId: run.id, requestId: 'mcp-request-0001' },
    });
    expect(payment.isError).toBe(true);
    expect(payment.structuredContent).toMatchObject({ code: 'PAYMENT_FAILED' });
    await client.close();
    await server.close();
  });

  it('rejects wrong grants and revokes all session grants', async () => {
    const { db, run, token, runtime } = await setup();
    const unauthorized = await connect(runtime, `${token.slice(0, -1)}X`);
    const denied = await unauthorized.client.callTool({
      name: 'get_run_status',
      arguments: { runId: run.id },
    });
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent).toMatchObject({ code: 'GRANT_INVALID' });
    await unauthorized.client.close();
    await unauthorized.server.close();

    revokeSessionAgentGrants(db, 'test-session');
    const revoked = await connect(runtime, token);
    const result = await revoked.client.callTool({
      name: 'get_receipt',
      arguments: { runId: run.id },
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: 'GRANT_REVOKED' });
    await revoked.client.close();
    await revoked.server.close();
  });

  it('stops a run and revokes its grant before a second call', async () => {
    const { run, token, runtime, ledger } = await setup();
    const { server, client } = await connect(runtime, token);
    const stopped = await client.callTool({
      name: 'stop_run',
      arguments: { runId: run.id },
    });
    expect(stopped.structuredContent).toMatchObject({
      runId: run.id,
      status: 'stopped',
      grantRevoked: true,
    });
    expect(ledger.getRun(run.id).status).toBe('stopped');
    const after = await client.callTool({
      name: 'get_run_status',
      arguments: { runId: run.id },
    });
    expect(after.isError).toBe(true);
    expect(after.structuredContent).toMatchObject({ code: 'GRANT_REVOKED' });
    await client.close();
    await server.close();
  });

  it('keeps the real stdio bridge parseable and quiet on stdout', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'allowance-mcp-'));
    tempDirs.push(directory);
    const databasePath = path.join(directory, 'allowance.sqlite');
    const config = loadConfig({
      DATABASE_PATH: databasePath,
      APP_ORIGIN: 'http://127.0.0.1:4318',
      MCP_ENABLED: 'true',
      LIVE_PAYMENTS_ENABLED: 'false',
      MERCHANT_RECIPIENT: '11111111111111111111111111111111',
    });
    const db = openDatabase(databasePath);
    const ledger = new Ledger(db, config);
    const run = ledger.createRun(
      {
        wallet: '11111111111111111111111111111111',
        task: 'Explain this wallet activity.',
        allowance: '0.04',
        perRequestCap: '0.02',
        expiresInMinutes: 10,
        allowedTools: ['wallet_snapshot', 'transaction_explain'],
      },
      'operator',
      'external'
    );
    ledger.setStatus(run.id, 'running');
    const grant = createAgentGrant(db, ledger, {
      runId: run.id,
      owner: 'operator',
      sessionId: 'stdio-session',
      expiresAt: run.policy.expiresAt,
    });
    db.close();

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx/esm', 'server/mcp.ts'],
      cwd: process.cwd(),
      stderr: 'pipe',
      env: {
        PATH: process.env.PATH ?? '',
        NODE_ENV: 'test',
        APP_ORIGIN: 'http://127.0.0.1:4318',
        DATABASE_PATH: databasePath,
        MCP_ENABLED: 'true',
        MCP_GRANT_TOKEN: grant.token,
        LIVE_PAYMENTS_ENABLED: 'false',
        MERCHANT_RECIPIENT: '11111111111111111111111111111111',
      },
    });
    const client = new Client({ name: 'allowance-stdio-test', version: '1.0.0' });
    await client.connect(transport);
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toContain('get_receipt');
    const status = await client.callTool({
      name: 'get_run_status',
      arguments: { runId: run.id },
    });
    expect(status.structuredContent).toMatchObject({ runId: run.id, executionMode: 'external' });
    await client.close();
  });
});
