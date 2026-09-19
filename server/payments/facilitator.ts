import { z } from 'zod';
import type { FacilitatorClient } from '@x402/core/server';
import type { Network, PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { isBase58Bytes } from '../../shared/domain.js';
import { PaymentError } from './guard.js';
import { boundedJson } from './rpc.js';

const network = z.custom<Network>(
  (value) =>
    typeof value === 'string' && /^[a-z0-9-]+:[A-Za-z0-9_-]+$/.test(value) && value.length <= 128
);
const optionalText = z
  .string()
  .max(2048)
  .nullish()
  .transform((value) => value ?? undefined);
const extra = z
  .record(z.string(), z.unknown())
  .nullish()
  .transform((value) => value ?? undefined);
export const settlementResponseSchema = z
  .object({
    success: z.boolean(),
    transaction: z.string().max(88),
    network,
    payer: optionalText,
    amount: z
      .string()
      .regex(/^(0|[1-9]\d*)$/)
      .max(20)
      .nullish()
      .transform((value) => value ?? undefined),
    errorReason: optionalText,
    errorMessage: optionalText,
    extensions: extra,
    extra,
  })
  .superRefine((value, context) => {
    if (
      value.success &&
      value.network.startsWith('solana:') &&
      !isBase58Bytes(value.transaction, 64)
    )
      context.addIssue({ code: 'custom', message: 'Invalid settlement transaction identity.' });
  });
const verificationSchema = z.object({
  isValid: z.boolean(),
  payer: optionalText,
  invalidReason: optionalText,
  invalidMessage: optionalText,
  extensions: extra,
  extra,
});
const supportedSchema = z.object({
  kinds: z
    .array(
      z.object({
        x402Version: z.number().int().min(1).max(2),
        scheme: z.string().max(64),
        network,
        extra,
      })
    )
    .max(128),
  extensions: z.array(z.string().max(128)).max(64).default([]),
  signers: z.record(z.string(), z.array(z.string().max(128)).max(64)).default({}),
});

/** Pinned x402 v2 facilitator wire contract, with no redirects or automatic retries. */
export function createBoundedFacilitatorClient(options: {
  url: string;
  bearerToken?: string;
  fetch?: typeof fetch;
}): FacilitatorClient {
  const endpoint = new URL(options.url);
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    throw new PaymentError(
      'facilitator',
      'Facilitator must be a fixed HTTPS endpoint without credentials, query or fragment.'
    );
  const base = endpoint.href.replace(/\/+$/, '');
  const fetcher = options.fetch ?? fetch;
  async function request<T>(
    operation: 'supported' | 'verify' | 'settle',
    schema: z.ZodType<T>,
    payload?: PaymentPayload,
    requirements?: PaymentRequirements
  ): Promise<T> {
    try {
      const response = await fetcher(`${base}/${operation}`, {
        method: operation === 'supported' ? 'GET' : 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(options.bearerToken ? { authorization: `Bearer ${options.bearerToken}` } : {}),
        },
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
        ...(payload
          ? {
              body: JSON.stringify({
                x402Version: payload.x402Version,
                paymentPayload: payload,
                paymentRequirements: requirements,
              }),
            }
          : {}),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error('Rejected response.');
      }
      return schema.parse(await boundedJson(response, 64 * 1024));
    } catch {
      throw new PaymentError(
        'facilitator-unavailable',
        `Facilitator ${operation} failed or returned an invalid bounded response.`
      );
    }
  }
  return {
    getSupported: () => request('supported', supportedSchema),
    verify: (payload, requirements) => request('verify', verificationSchema, payload, requirements),
    settle: (payload, requirements) =>
      request('settle', settlementResponseSchema, payload, requirements),
  };
}
