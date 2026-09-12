import 'dotenv/config';
import path from 'node:path';
import { CATALOG, parseMoney, type DataNetwork } from '../shared/domain.js';
export interface Config {
  port: number;
  host: string;
  production: boolean;
  origin: string;
  databasePath: string;
  passwordHash: string;
  sessionSecret: string;
  proxyHops: number;
  liveEnabled: boolean;
  payerSecretFile: string;
  payerSecretJson: string;
  recipient: string;
  facilitatorUrl: string;
  facilitatorToken: string;
  trustedFeePayer: string;
  paymentRpcUrl: string;
  dataRpcUrl: string;
  dataNetwork: DataNetwork;
  allowMainnetReadOnly: boolean;
  dailyCeiling: number;
  maxAllowance: number;
  openaiApiKey: string;
  openaiModel: string;
  defaultWallet: string;
  maxLlmCalls: number;
  maxLlmOutputTokens: number;
  maxRuntimeMs: number;
}
function integer(value: string | undefined, fallback: number, min: number, max: number) {
  const n = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max)
    throw new Error('Invalid bounded numeric configuration.');
  return n;
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const port = integer(env.PORT, 4318, 1024, 65535);
  const origin = env.APP_ORIGIN || `http://127.0.0.1:${port}`;
  const url = new URL(origin);
  if (
    url.origin !== origin ||
    url.username ||
    url.password ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
  )
    throw new Error('APP_ORIGIN must be HTTPS or an exact local development origin.');
  if (env.PAYMENT_NETWORK && env.PAYMENT_NETWORK !== 'devnet')
    throw new Error('Only devnet payments are supported.');
  const dataNetwork = env.DATA_NETWORK || 'devnet';
  if (dataNetwork !== 'devnet' && dataNetwork !== 'mainnet')
    throw new Error('Unknown data network.');
  if (dataNetwork === 'mainnet' && env.ALLOW_MAINNET_READ_ONLY !== 'true')
    throw new Error('Mainnet data reads require separate explicit configuration.');
  return {
    port,
    host: env.HOST || '127.0.0.1',
    production,
    origin,
    databasePath: path.resolve(env.DATABASE_PATH || 'var/allowance.sqlite'),
    passwordHash: env.OPERATOR_PASSWORD_HASH || '',
    sessionSecret: env.SESSION_SECRET || '',
    proxyHops: integer(env.PROXY_HOPS, 0, 0, 2),
    liveEnabled: env.LIVE_PAYMENTS_ENABLED === 'true',
    payerSecretFile: env.PAYER_SECRET_FILE || '',
    payerSecretJson: env.PAYER_SECRET_JSON || '',
    recipient: env.MERCHANT_RECIPIENT || '',
    facilitatorUrl: env.FACILITATOR_URL || 'https://x402.org/facilitator',
    facilitatorToken: env.FACILITATOR_TOKEN || '',
    trustedFeePayer: env.TRUSTED_FEE_PAYER || '',
    paymentRpcUrl: env.PAYMENT_RPC_URL || 'https://api.devnet.solana.com',
    dataRpcUrl: env.DATA_RPC_URL || 'https://api.devnet.solana.com',
    dataNetwork: dataNetwork as DataNetwork,
    allowMainnetReadOnly: env.ALLOW_MAINNET_READ_ONLY === 'true',
    dailyCeiling: parseMoney(env.DAILY_USDC_CEILING || '0.100000'),
    maxAllowance: parseMoney(env.MAX_RUN_ALLOWANCE || '0.040000'),
    openaiApiKey: env.OPENAI_API_KEY || '',
    openaiModel: env.OPENAI_MODEL || '',
    defaultWallet: env.DEMO_WALLET || '',
    maxLlmCalls: integer(env.LLM_MAX_CALLS, 5, 1, 6),
    maxLlmOutputTokens: integer(env.LLM_MAX_OUTPUT_TOKENS, 1200, 256, 2000),
    maxRuntimeMs: 180_000,
  };
}
export function authenticationConfigured(config: Config): boolean {
  return config.passwordHash.startsWith('$argon2id$') && config.sessionSecret.length >= 32;
}
export function configurationReadiness(config: Config) {
  return [
    {
      name: 'Operator access',
      ready: authenticationConfigured(config),
      detail: authenticationConfigured(config)
        ? 'Password hash and persistent sessions configured.'
        : 'Run npm run setup:operator to configure password hash and session secret.',
    },
    {
      name: 'Devnet payments',
      ready: config.liveEnabled,
      detail: config.liveEnabled
        ? 'Explicit devnet opt-in enabled.'
        : 'Set LIVE_PAYMENTS_ENABLED=true only after devnet funding and preflight.',
    },
    {
      name: 'Development signer',
      ready: Boolean(config.payerSecretFile || config.payerSecretJson),
      detail:
        config.payerSecretFile || config.payerSecretJson
          ? 'Backend-only signer source configured; preflight must validate it.'
          : 'Set PAYER_SECRET_FILE to an ignored dedicated devnet keypair file.',
    },
    {
      name: 'Merchant recipient',
      ready: Boolean(config.recipient),
      detail: config.recipient
        ? 'Recipient configured; must differ from signer and have a USDC account.'
        : 'Set MERCHANT_RECIPIENT to a separate devnet token owner.',
    },
    {
      name: 'Trusted fee sponsor',
      ready: Boolean(config.trustedFeePayer),
      detail: config.trustedFeePayer
        ? 'Pinned sponsor requires facilitator and transaction checks.'
        : 'Set TRUSTED_FEE_PAYER after inspecting the facilitator supported response.',
    },
    {
      name: 'OpenAI agent',
      ready: Boolean(config.openaiApiKey && config.openaiModel),
      detail:
        config.openaiApiKey && config.openaiModel
          ? `Configured model: ${config.openaiModel}. Provider usage is separate from USDC.`
          : 'Set OPENAI_API_KEY and OPENAI_MODEL. See the documented verified model example.',
    },
  ];
}
export const catalogByName = Object.fromEntries(CATALOG.map((tool) => [tool.name, tool]));
