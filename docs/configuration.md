# Runtime configuration reference

All variables below are **server-only**, except `VITE_REHEARSAL_ONLY`. Configure secrets through a private environment or mounted secret file; never through a browser, public export or `VITE_*`. Readiness reports presence and validation results, not credentials. `.env.example` is a template, not a funded configuration. Mainnet is the default network and signing defaults off.

| Variable | Shape / default | Required when; source and purpose |
| --- | --- | --- |
| `NODE_ENV` | `production` on a deployed backend | Host setting; serves compiled assets and production headers. |
| `PORT` | Integer 1024–65535; `4318` | Host listener port. |
| `HOST` | Listener address; `127.0.0.1` | Host setting; use `0.0.0.0` inside a container with a restricted published port. |
| `APP_ORIGIN` | Exact HTTPS origin; exact loopback HTTP allowed locally | Host's real console origin, with no path, credentials or trailing slash. Own API/merchant requests and CSRF must match. |
| `DATABASE_PATH` | Writable path; `var/allowance.sqlite` | Durable volume for every persistent mode; `/data/allowance.sqlite` in the container. Never ephemeral serverless storage. |
| `OPERATOR_PASSWORD_HASH` | Argon2id hash | All operator sessions. Generate privately with `npm run setup:operator`; never put a plain password here. |
| `SESSION_SECRET` | At least 32 characters | All operator sessions. Setup generates cryptographic random data; retain across ordinary restarts and rotate deliberately to invalidate sessions. |
| `PROXY_HOPS` | Integer 0–2; `0` | Exact trusted reverse-proxy hop count. Set `1` only behind the specified single proxy; restrict direct backend access. |
| `LIVE_PAYMENTS_ENABLED` | Literal `true`; otherwise false | Required for new paid work. Human-reviewed configuration is required before enabling. Does not itself authorize a funded test. |
| `PAYMENT_NETWORK` | `mainnet` or `devnet`; `mainnet` | Must be explicitly set in live mode. Frozen into each run; never relabel existing receipts. |
| `MAINNET_PAYMENTS_ACKNOWLEDGED` | Literal `true`; default false | Required with live mainnet. Acknowledge actual USDC and reviewed limits; independent of deployment permission. |
| `PAYER_SECRET_FILE` | Path to 64-byte JSON keypair | Dedicated low-balance signer; private read-only secret mount. Required for payment readiness unless JSON alternative supplied. |
| `PAYER_SECRET_JSON` | 64 integer bytes, JSON array | Server-only alternative to key file. Prefer the mounted file and configure only one source. |
| `MERCHANT_RECIPIENT` | 32-byte base58 token-owner address | Dedicated merchant account, different from payer; matching initialized USDC associated account required. Supplied by operator. |
| `PAYMENT_RPC_URL` | HTTPS endpoint, no embedded username/password/fragment | Explicit in live mode. Operator's provider; genesis, mint, token accounts and independent payment evidence are checked. |
| `FACILITATOR_URL` | HTTPS base URL, no embedded credentials/query/fragment | Explicit in live mode. Selected provider must advertise x402 v2 exact on the chosen Solana network and pinned sponsor. The bounded adapter refuses redirects and does not retry. |
| `FACILITATOR_TOKEN` | Optional bearer token | From selected provider if required; never exposed publicly. Providers using another auth scheme require a compatible adapter. |
| `TRUSTED_FEE_PAYER` | 32-byte base58 address, different from payer | Operator pins the provider's reviewed sponsor; an endpoint response alone never grants trust. |
| `DAILY_USDC_CEILING` | Canonical decimal, at most 6 decimals; `0.100000` | Shared payer limit in USDC, not SOL/provider cost; review against funding. Unresolved holds continue counting across UTC days. |
| `MAX_RUN_ALLOWANCE` | Canonical decimal; `0.040000` | Maximum operator-selectable run allowance, independent of per-request cap. |
| `DATA_NETWORK` | `mainnet` or `devnet`; selected payment network | Provenance of useful data, independent of payment network. Frozen run labels show both when they differ. |
| `DATA_RPC_URL` | HTTPS endpoint; network public RPC by default | Read-only data provider. Bounded responses, no redirects, genesis checked. |
| `ALLOW_MAINNET_READ_ONLY` | Literal `true`; default false | Separate permission to read mainnet data. Does not enable mainnet payments. |
| `DEMO_WALLET` | 32-byte base58 wallet address | Prepared data wallet for repeatable smoke; actual history may be empty. No private key is needed for the data wallet. |
| `OPENAI_API_KEY` | Provider API credential | Built-in agent only; from the operator's OpenAI project. External MCP mode does not need it. |
| `OPENAI_MODEL` | Explicit Responses-compatible model identifier | Built-in agent only. Example `gpt-5-mini` is documented; account access is not inferred. No silent fallback. |
| `LLM_MAX_CALLS` | Integer 1–6; `5` | Built-in model request cap. SDK retries disabled. |
| `LLM_MAX_OUTPUT_TOKENS` | Integer 256–2000; `1200` | Per-model-call generated-token cap; provider billing remains separate from tool USDC. |
| `MCP_ENABLED` | Literal `true`; default false | Enables human-created external-run grants/local stdio adapter, not remote public MCP. |
| `MCP_GRANT_TOKEN` | One-time-visible high-entropy token | Private stdio client environment only; from authenticated `POST /api/external-runs`. Bound to run, session, scope and expiry; do not pass to the model. |
| `VITE_REHEARSAL_ONLY` | Build constant `true` for public Vercel | The static build script forces this value and disables environment-file loading. No secret or network endpoint belongs in client configuration. |

The code also enforces a 180-second run duration, four tool proposals, 48,000 accumulated model-input characters, fixed catalog prices, a 15,000-lamport fee limit per payment and bounded provider responses. These are application controls rather than editable model inputs. The default scripted two-purchase smoke consumes at most 30,000 micro-USDC, with no third payment for its denied 20,000 probe. Two fee caps total at most 30,000 lamports paid by the separately pinned sponsor. Account creation is excluded; no paid model call is part of that smoke.

Runtime parsing rejects inconsistent live network/RPC/facilitator settings and missing mainnet acknowledgement. Payment readiness verifies actual accounts/provider support; key presence alone is insufficient. See [live setup](live-setup.md), [MCP](mcp.md) and [integration status](integration-status.md) for capability-specific blockers.
