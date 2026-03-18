import { Cache } from '../../services/cache.js';
import { OnChainService } from '../../services/onchain.js';

function mockOkResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe('OnChainService', () => {
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch;
  });

  it('getMetrics returns the latest mapped on-chain metrics for a coin', async () => {
    mockFetch
      .mockResolvedValueOnce(mockOkResponse([{ t: 1, v: 1200 }, { t: 2, v: 1500 }]))
      .mockResolvedValueOnce(mockOkResponse([{ t: 1, v: 1800 }, { t: 2, v: 2300 }]))
      .mockResolvedValueOnce(mockOkResponse([{ t: 1, v: 750000 }, { t: 2, v: 820000 }]))
      .mockResolvedValueOnce(mockOkResponse([{ t: 1, v: 220 }, { t: 2, v: 310 }]))
    ;

    const service = new OnChainService('test-onchain-key', 'https://example.com/v1/metrics', new Cache());
    const result = await service.getMetrics('bitcoin');

    expect(result).toEqual({
      exchange_inflow: 1500,
      exchange_outflow: 2300,
      active_addresses_24h: 820000,
      large_tx_count_24h: 310,
    });
    expect(mockFetch).toHaveBeenCalledTimes(4);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('api_key=test-onchain-key'),
      expect.anything()
    );
  });

  it('getMetrics returns null and does not call fetch when ONCHAIN_API_KEY is absent', async () => {
    const service = new OnChainService('', 'https://example.com/v1/metrics', new Cache());

    const result = await service.getMetrics('bitcoin');

    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('getMetrics reuses the 15-minute cache on repeated calls', async () => {
    mockFetch
      .mockResolvedValueOnce(mockOkResponse([{ t: 2, v: 1500 }]))
      .mockResolvedValueOnce(mockOkResponse([{ t: 2, v: 2300 }]))
      .mockResolvedValueOnce(mockOkResponse([{ t: 2, v: 820000 }]))
      .mockResolvedValueOnce(mockOkResponse([{ t: 2, v: 310 }]))
    ;

    const service = new OnChainService('test-onchain-key', 'https://example.com/v1/metrics', new Cache());

    const first = await service.getMetrics('bitcoin');
    const second = await service.getMetrics('bitcoin');

    expect(first).toEqual(second);
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });
});