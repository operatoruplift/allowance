import Database from 'better-sqlite3';
import { pathToFileURL } from 'node:url';
import {
  authenticationConfigured,
  configurationReadiness,
  loadConfig,
  type Config,
} from './config.js';
import { SCHEMA_VERSION } from './db/index.js';
import { restoreReadiness } from './db/recovery.js';
import { Ledger } from './policy/ledger.js';
import { MandateLedger } from './direct/ledger.js';
import { createDirectPaymentService } from './direct/service.js';
import { createPaymentService } from './payments/index.js';
import { SolanaDataClient } from './data/solana.js';

export type PreflightRail = 'x402' | 'direct' | 'all';
const usage = 'Usage: npm run preflight -- [--rail x402|direct|all]';

export function parsePreflightRail(args: string[]): PreflightRail {
  if (args.length === 0) return 'x402';
  const value =
    args.length === 2 && args[0] === '--rail'
      ? args[1]
      : args.length === 1 && args[0].startsWith('--rail=')
        ? args[0].slice('--rail='.length)
        : undefined;
  if (value !== 'x402' && value !== 'direct' && value !== 'all') throw new Error(usage);
  return value;
}

const unavailable = (error: string) => ({ ready: false as const, error });
const skipped = { checked: false as const, reason: 'Not required for the selected rail.' };
const denySpending = () => {
  throw new Error('Read-only preflight cannot authorize spending.');
};

/** Read an existing journal. Never initialize, migrate, recover, or acquire a service lease. */
export async function runPreflight(config: Config, rail: PreflightRail = 'x402') {
  const checkX402 = rail !== 'direct';
  const checkDirect = rail !== 'x402';
  const configuration = checkX402
    ? configurationReadiness(config)
    : [
        {
          name: 'Operator access',
          ready: authenticationConfigured(config),
          detail: authenticationConfigured(config)
            ? 'Password hash and persistent sessions configured.'
            : 'Run npm run setup:operator to configure password hash and session secret.',
        },
      ];
  const base = {
    recordedAt: new Date().toISOString(),
    kind: 'read-only preflight; no signing, LLM call or settlement',
    rail,
    paymentNetwork: config.paymentNetwork,
    dataNetwork: config.dataNetwork,
    configuration,
  };
  let db: Database.Database | undefined;
  try {
    db = new Database(config.databasePath, { readonly: true, fileMustExist: true });
    const schema = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
      version: number | null;
    };
    if (schema.version !== SCHEMA_VERSION) throw new Error('Journal schema is not current.');
    configuration.push(restoreReadiness(db));
    const ledger = new Ledger(db, config, Date.now, denySpending);
    const payerFrozen = ledger.payerFrozen();
    configuration.push({
      name: 'Payment recovery',
      ready: !payerFrozen,
      detail: payerFrozen
        ? 'An uncertain payment holds this payer. Reconcile original payments before new spending.'
        : 'No unresolved signed payment holds the payer.',
    });
    const data = checkX402
      ? new SolanaDataClient({
          rpcUrl: config.dataRpcUrl,
          cluster: config.dataNetwork === 'mainnet' ? 'mainnet-beta' : 'devnet',
          allowMainnetReadOnly: config.allowMainnetReadOnly,
        })
      : undefined;
    // Readiness methods validate the configured key source and observe RPC/provider state.
    // No paid method is called or model created; readonly SQLite and denySpending fence writes.
    const results = await Promise.allSettled([
      checkX402
        ? createPaymentService(
            {
              enabled: config.liveEnabled,
              network: config.paymentNetwork,
              merchantOrigin: config.origin,
              recipient: config.recipient,
              rpcUrl: config.paymentRpcUrl,
              keyFile: config.payerSecretFile,
              secretKey: config.payerSecretJson,
              facilitatorUrl: config.facilitatorUrl,
              facilitatorBearerToken: config.facilitatorToken,
              trustedFeeSponsor: config.trustedFeePayer,
              allowLocalHttp:
                !config.production ||
                ['localhost', '127.0.0.1'].includes(new URL(config.origin).hostname),
              maxFeeLamports: 15000,
            },
            ledger,
            data!
          ).then((service) => service.readiness())
        : Promise.resolve(skipped),
      checkX402 ? data!.probe() : Promise.resolve(skipped),
      checkDirect
        ? createDirectPaymentService(config, {
            ledger,
            mandates: new MandateLedger(db, config, ledger, Date.now, denySpending),
          }).then((service) => service.readiness())
        : Promise.resolve(skipped),
    ]);
    const payments =
      results[0].status === 'fulfilled'
        ? results[0].value
        : unavailable(
            'Payment preflight unavailable. Check configuration and initialized journal.'
          );
    const dataResult =
      results[1].status === 'fulfilled'
        ? results[1].value
        : unavailable('Data preflight unavailable.');
    const direct =
      results[2].status === 'fulfilled'
        ? results[2].value
        : unavailable('Direct payment preflight unavailable.');
    const passed = (result: typeof payments | typeof dataResult | typeof direct) =>
      'ready' in result && result.ready;
    return {
      ...base,
      ready:
        configuration.every((item) => item.ready) &&
        (!checkX402 || (passed(payments) && passed(dataResult))) &&
        (!checkDirect || passed(direct)),
      payments,
      data: dataResult,
      direct,
    };
  } catch {
    configuration.push({
      name: 'Existing journal',
      ready: false,
      detail:
        'Start the configured server once to initialize or migrate its durable journal, then rerun preflight. Preflight never creates or changes the journal.',
    });
    return {
      ...base,
      ready: false,
      payments: checkX402 ? unavailable('Existing journal unavailable.') : skipped,
      data: checkX402 ? unavailable('Not checked: existing journal unavailable.') : skipped,
      direct: checkDirect ? unavailable('Existing journal unavailable.') : skipped,
    };
  } finally {
    db?.close();
  }
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    process.stdout.write(
      `${usage}\nDefault: x402 (built-in agent and data checks). Direct skips x402, data and model checks. All requires both rails.\n`
    );
    return;
  }
  let rail: PreflightRail;
  try {
    rail = parsePreflightRail(args);
  } catch {
    process.stderr.write(`${usage}\n`);
    process.exitCode = 2;
    return;
  }
  try {
    const evidence = await runPreflight(loadConfig(), rail);
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    if (!evidence.ready) process.exitCode = 1;
  } catch {
    process.stderr.write(
      'Invalid preflight configuration. Review docs/configuration.md; no payment was attempted.\n'
    );
    process.exitCode = 1;
  }
}

// The production command uses only compiled code; imports remain side-effect free.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
