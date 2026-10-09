import { api, ApiError, apiUrl, setAuthToken, setUnauthorizedHandler, wsUrl } from '../api';

const respond = (status: number, body: unknown) =>
  jest.fn().mockResolvedValue({ ok: status < 400, status, json: () => Promise.resolve(body) });

beforeEach(() => {
  setAuthToken(null);
  setUnauthorizedHandler(() => {});
});

describe('urls', () => {
  it('maps http to ws', () => {
    expect(wsUrl('/ws')).toBe(apiUrl('/ws').replace(/^http/, 'ws'));
  });
});

describe('api', () => {
  it('GETs without a body and returns parsed JSON', async () => {
    globalThis.fetch = respond(200, { ok: true });
    await expect(api('/health')).resolves.toEqual({ ok: true });
    expect(globalThis.fetch).toHaveBeenCalledWith(apiUrl('/health'), expect.objectContaining({ method: 'GET', body: undefined }));
  });

  it('POSTs a JSON body with the bearer token', async () => {
    globalThis.fetch = respond(200, {});
    setAuthToken('t0k');
    await api('/orders', { body: { a: 1 } });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      apiUrl('/orders'),
      expect.objectContaining({
        method: 'POST',
        body: '{"a":1}',
        headers: { 'content-type': 'application/json', authorization: 'Bearer t0k' },
      }),
    );
  });

  it('throws the server error message', async () => {
    globalThis.fetch = respond(422, { error: 'Bad input' });
    await expect(api('/orders')).rejects.toEqual(new ApiError(422, 'Bad input'));
  });

  it('calls the unauthorized handler on 401 only when signed in', async () => {
    const handler = jest.fn();
    setUnauthorizedHandler(handler);
    globalThis.fetch = respond(401, {});

    await expect(api('/me')).rejects.toBeInstanceOf(ApiError);
    expect(handler).not.toHaveBeenCalled();

    setAuthToken('t0k');
    await expect(api('/me')).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('reports network failures as status 0', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    await expect(api('/health')).rejects.toMatchObject({ status: 0 });
  });
});
