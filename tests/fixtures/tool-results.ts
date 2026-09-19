import type { DataNetwork } from '../../shared/domain.js';

const observation = {
  source: 'Solana JSON-RPC' as const,
  commitment: 'confirmed' as const,
  observedAt: '2026-09-20T00:00:00.000Z',
};
// Controlled provider facts for adapter tests; these are never exported as live evidence.
export function snapshotFixture(
  address: string,
  signatures: string[] = [],
  network: DataNetwork = 'mainnet'
) {
  return {
    address,
    dataCluster: network === 'mainnet' ? ('mainnet-beta' as const) : ('devnet' as const),
    balanceLamports: '0',
    balanceSol: '0.000000000',
    recentSignatures: signatures.map((signature) => ({
      signature,
      slot: '100',
      blockTime: null,
      status: 'success' as const,
      confirmationStatus: 'confirmed' as const,
    })),
    historyState: signatures.length ? ('available' as const) : ('empty' as const),
    provenance: { ...observation, balanceSlot: '100', historyLimit: 8 as const },
    limitations: ['Controlled fixture; not a live network observation.'],
  };
}
export function explanationFixture(
  signature: string,
  feePayer: string,
  network: DataNetwork = 'mainnet'
) {
  return {
    signature,
    dataCluster: network === 'mainnet' ? ('mainnet-beta' as const) : ('devnet' as const),
    status: 'success' as const,
    feeLamports: '5000',
    feeSol: '0.000005000',
    feePayer,
    instructions: [],
    nativeBalanceChanges: [],
    tokenBalanceChanges: [],
    provenance: {
      ...observation,
      slot: '100',
      blockTime: null,
      maxSupportedTransactionVersion: 0 as const,
    },
    limitations: ['Controlled fixture; not a live network observation.'],
    tokenBalanceCoverage: 'unavailable-or-partial' as const,
  };
}
