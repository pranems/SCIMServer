import { describe, expect, it, vi } from 'vitest';
import {
  AuthenticatedSseError,
  isAuthenticatedSseAuthError,
  openAuthenticatedSse,
} from './authenticated-sse';

function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('openAuthenticatedSse', () => {
  it('sends the bearer token in Authorization, never in the URL, and parses split SSE messages', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      streamResponse([
        'event: connected\ndata: {"message":"connected"}\n\n',
        'data: {"type":"scim.user.',
        'created","endpointId":"ep-1"}\n\n',
      ]),
    );
    const onOpen = vi.fn();
    const onMessage = vi.fn();
    const onError = vi.fn();

    const connection = openAuthenticatedSse({
      url: '/scim/admin/log-config/stream?level=INFO',
      token: 'test-token',
      fetchImpl,
      onOpen,
      onMessage,
      onError,
    });

    await connection.completed;

    expect(fetchImpl).toHaveBeenCalledWith(
      '/scim/admin/log-config/stream?level=INFO',
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-token' },
      }),
    );
    expect(String(fetchImpl.mock.calls[0][0])).not.toContain('test-token');
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledTimes(2);
    expect(onMessage).toHaveBeenLastCalledWith('{"type":"scim.user.created","endpointId":"ep-1"}');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'SSE stream ended' }));
  });

  it('surfaces an unauthorized response without exposing the token', async () => {
    const onError = vi.fn();
    const connection = openAuthenticatedSse({
      url: '/scim/admin/log-config/stream?level=DEBUG',
      token: 'test-token',
      fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
      onOpen: vi.fn(),
      onMessage: vi.fn(),
      onError,
    });

    await connection.completed;

    const error = onError.mock.calls[0][0];
    expect(error).toBeInstanceOf(AuthenticatedSseError);
    expect(error).toMatchObject({
      message: 'SSE request failed with 401',
      status: 401,
    });
    expect(isAuthenticatedSseAuthError(error)).toBe(true);
  });
});
