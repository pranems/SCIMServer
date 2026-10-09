export interface AuthenticatedSseOptions {
  url: string;
  token?: string;
  onOpen: () => void;
  onMessage: (data: string) => void;
  onError: (error: Error) => void;
  fetchImpl?: typeof fetch;
}

export interface AuthenticatedSseConnection {
  close: () => void;
  completed: Promise<void>;
}

function eventData(block: string): string | undefined {
  const lines = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart());
  return lines.length > 0 ? lines.join('\n') : undefined;
}

export function openAuthenticatedSse(options: AuthenticatedSseOptions): AuthenticatedSseConnection {
  const controller = new AbortController();
  const fetchImpl = options.fetchImpl ?? fetch;
  let closed = false;

  const completed = (async () => {
    try {
      const headers: Record<string, string> = {};
      if (options.token) headers.Authorization = `Bearer ${options.token}`;

      const response = await fetchImpl(options.url, {
        method: 'GET',
        headers,
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`SSE request failed with ${response.status}`);
      }
      if (!response.body) {
        throw new Error('SSE response has no readable body');
      }

      options.onOpen();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (!closed) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n');

        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = eventData(block);
          if (data !== undefined) options.onMessage(data);
          boundary = buffer.indexOf('\n\n');
        }

        if (done) {
          if (!closed) options.onError(new Error('SSE stream ended'));
          return;
        }
      }
    } catch (error) {
      if (closed || (error as Error).name === 'AbortError') return;
      options.onError(error instanceof Error ? error : new Error(String(error)));
    }
  })();

  return {
    close: () => {
      closed = true;
      controller.abort();
    },
    completed,
  };
}
