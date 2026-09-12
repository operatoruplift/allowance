import { loadConfig, type Config } from './config.js';
import { acquireServiceLease } from './db/lease.js';
import { openDatabase } from './db/index.js';
import { Ledger } from './policy/ledger.js';
import { SolanaDataClient } from './data/solana.js';
import { createPaymentService } from './payments/index.js';
import { AgentRunner, openaiModel } from './agent/runner.js';
export async function createRuntime(
  config: Config = loadConfig(),
  options: { recover?: boolean; exclusive?: boolean } = {}
) {
  const db = openDatabase(config.databasePath);
  const lease =
    (options.exclusive ?? options.recover !== false) ? acquireServiceLease(db) : undefined;
  const ledger = new Ledger(db, config, Date.now, lease?.assert);
  if (options.recover !== false) ledger.recoverStartup();
  const heartbeat = lease
    ? setInterval(() => {
        try {
          lease.renew();
        } catch {
          clearInterval(heartbeat);
          process.stderr.write(
            'Service lease lost; all new spending is denied. Restart the service.\n'
          );
        }
      }, 5000)
    : undefined;
  heartbeat?.unref();
  const data = new SolanaDataClient({
    rpcUrl: config.dataRpcUrl,
    cluster: config.dataNetwork === 'mainnet' ? 'mainnet-beta' : 'devnet',
    allowMainnetReadOnly: config.allowMainnetReadOnly,
  });
  const payments = await createPaymentService(
    {
      enabled: config.liveEnabled,
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
        new URL(config.origin).hostname === 'localhost' ||
        new URL(config.origin).hostname === '127.0.0.1',
      maxFeeLamports: 15000,
    },
    ledger,
    data
  );
  const runner =
    config.openaiApiKey && config.openaiModel
      ? new AgentRunner(ledger, config, payments, openaiModel(config))
      : null;
  return {
    config,
    db,
    ledger,
    data,
    payments,
    runner,
    close() {
      if (heartbeat) clearInterval(heartbeat);
      lease?.release();
      db.close();
    },
  };
}
