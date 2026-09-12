import { expect, it, vi } from 'vitest';
import { runPaidTool } from '../examples/paid-tool.js';
import type { PaymentLedger } from '../server/payments/contracts.js';
it('reusable client passes a stable purchase identity to the guarded HTTP client', async () => {
  const call = vi.fn().mockResolvedValue({ balanceSol: '1.000000000' });
  const getIntent = vi.fn().mockReturnValue({ id: 'stable-id', status: 'delivered' });
  const result = await runPaidTool(
    { runPaidTool: call },
    { getIntent } as unknown as PaymentLedger,
    {
      runId: 'authorized-run',
      requestId: 'stable-id',
      tool: 'wallet_snapshot',
      args: { address: '11111111111111111111111111111111' },
    }
  );
  expect(call).toHaveBeenCalledWith('authorized-run', 'stable-id', 'wallet_snapshot', {
    address: '11111111111111111111111111111111',
  });
  expect(result.purchase?.status).toBe('delivered');
  expect(result.data).toEqual({ balanceSol: '1.000000000' });
});
