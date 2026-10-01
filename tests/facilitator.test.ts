import { expect, it, vi } from 'vitest';
import {
  createBoundedFacilitatorClient,
  settlementResponseSchema,
} from '../server/payments/facilitator.js';
import { PAYMENT_CHAINS } from '../shared/domain.js';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';

const requirements: PaymentRequirements = {
  scheme: 'exact',
  network: PAYMENT_CHAINS.devnet.network,
  amount: '10000',
  asset: PAYMENT_CHAINS.devnet.mint,
  payTo: '11111111111111111111111111111111',
  maxTimeoutSeconds: 60,
  extra: {},
};
const payload: PaymentPayload = {
  x402Version: 2,
  accepted: requirements,
  payload: { transaction: 'controlled' },
};

it('uses the installed v2 request shape with fixed endpoints, no redirects, a timeout and no retries', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify({ isValid: true })));
  const client = createBoundedFacilitatorClient({
    url: 'https://facilitator.example/v2',
    bearerToken: 'private-fixture',
    fetch: fetcher,
  });
  await expect(client.verify(payload, requirements)).resolves.toMatchObject({ isValid: true });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, request] = fetcher.mock.calls[0];
  expect(url).toBe('https://facilitator.example/v2/verify');
  expect(request).toMatchObject({ method: 'POST', redirect: 'error' });
  expect(request?.signal).toBeInstanceOf(AbortSignal);
  expect(JSON.parse(String(request?.body))).toEqual({
    x402Version: 2,
    paymentPayload: payload,
    paymentRequirements: requirements,
  });
});

it('accepts mixed provider discovery but exposes only strictly validated v2 capabilities', async () => {
  // Shape from PayAI's public /supported response; no provider is contacted by this test.
  const feePayer = 'CjNFTjvBhbJJd2B5ePPMHRLx1ELZpa8dwQgGL727eKww';
  const mainnet = {
    x402Version: 2,
    scheme: 'exact',
    network: PAYMENT_CHAINS.mainnet.network,
    extra: { feePayer, recentBlockhash: '11111111111111111111111111111111' },
  };
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      kinds: [
        { x402Version: 1, scheme: 'exact', network: 'base-sepolia' },
        { x402Version: 1, scheme: 'exact', network: 'solana', extra: { feePayer } },
        { x402Version: 1, scheme: 'exact', network: PAYMENT_CHAINS.mainnet.network },
        mainnet,
      ],
      extensions: ['bazaar'],
      signers: { 'solana:*': [feePayer] },
    })
  );
  const client = createBoundedFacilitatorClient({
    url: 'https://facilitator.example',
    fetch: fetcher,
  });
  await expect(client.getSupported()).resolves.toEqual({
    kinds: [mainnet],
    extensions: ['bazaar'],
    signers: { 'solana:*': [feePayer] },
  });
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(
    'https://facilitator.example/supported',
    expect.objectContaining({ method: 'GET', redirect: 'error' })
  );
});

it.each([
  { x402Version: 2, scheme: 'exact', network: 'solana' },
  { x402Version: 2, scheme: 'exact', network: 'solana:' },
  { x402Version: 2, scheme: 'exact', network: PAYMENT_CHAINS.mainnet.network, extra: 'bad' },
  { x402Version: 1, scheme: 'exact', network: 'https://unapproved.example' },
  { x402Version: 3, scheme: 'exact', network: PAYMENT_CHAINS.mainnet.network },
])(
  'rejects malformed discovery kinds instead of filtering away invalid v2 terms (%o)',
  async (kind) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        kinds: [{ x402Version: 1, scheme: 'exact', network: 'solana' }, kind],
      })
    );
    const client = createBoundedFacilitatorClient({
      url: 'https://facilitator.example',
      fetch: fetcher,
    });
    await expect(client.getSupported()).rejects.toThrow(
      'Facilitator supported failed or returned an invalid bounded response.'
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
);

it('does not promote a legacy-only facilitator to v2 support', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      kinds: [
        { x402Version: 1, scheme: 'exact', network: 'solana' },
        { x402Version: 1, scheme: 'exact', network: PAYMENT_CHAINS.mainnet.network },
      ],
    })
  );
  const client = createBoundedFacilitatorClient({
    url: 'https://facilitator.example',
    fetch: fetcher,
  });
  await expect(client.getSupported()).resolves.toMatchObject({ kinds: [] });
});

it.each([
  new Response('private-provider-body', {
    status: 302,
    headers: { location: 'https://unapproved.example' },
  }),
  new Response(JSON.stringify({ kinds: 'invalid' })),
  new Response(JSON.stringify({ kinds: [], unexpected: 'x'.repeat(66000) })),
])(
  'rejects redirect, malformed and oversized provider responses without exposing bodies',
  async (response) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
    const client = createBoundedFacilitatorClient({
      url: 'https://facilitator.example',
      fetch: fetcher,
    });
    await expect(client.getSupported()).rejects.toThrow(
      'Facilitator supported failed or returned an invalid bounded response.'
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
);

it('validates settlement headers instead of treating truthy strings as success', () => {
  expect(
    settlementResponseSchema.safeParse({
      success: 'true',
      transaction: '1'.repeat(64),
      network: PAYMENT_CHAINS.devnet.network,
    }).success
  ).toBe(false);
  expect(
    settlementResponseSchema.safeParse({
      success: true,
      transaction: 'invented',
      network: PAYMENT_CHAINS.devnet.network,
    }).success
  ).toBe(false);
  expect(
    settlementResponseSchema.safeParse({
      success: true,
      transaction: '1'.repeat(64),
      network: PAYMENT_CHAINS.devnet.network,
    }).success
  ).toBe(true);
});

it.each([
  'http://facilitator.example',
  'https://user:password@facilitator.example',
  'https://facilitator.example#redirect',
  'https://facilitator.example?token=secret',
])('rejects unsafe endpoint configuration %s', (url) => {
  expect(() => createBoundedFacilitatorClient({ url })).toThrow(/fixed HTTPS/);
});
