import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useCopyToClipboard } from './useCopyToClipboard';

describe('useCopyToClipboard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns idle status initially', () => {
    const { result } = renderHook(() => useCopyToClipboard());
    expect(result.current.status).toBe('idle');
  });

  it('transitions to copied on successful clipboard write', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const { result } = renderHook(() => useCopyToClipboard());
    await act(async () => {
      await result.current.copy('hello');
    });
    expect(writeText).toHaveBeenCalledWith('hello');
    expect(result.current.status).toBe('copied');
  });

  it('auto-resets to idle 1500ms after a successful copy', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const { result } = renderHook(() => useCopyToClipboard());
    await act(async () => {
      await result.current.copy('hi');
    });
    expect(result.current.status).toBe('copied');
    act(() => {
      vi.advanceTimersByTime(1499);
    });
    expect(result.current.status).toBe('copied');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.status).toBe('idle');
  });

  it('transitions to error when clipboard.writeText rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('blocked by browser'));
    Object.assign(navigator, { clipboard: { writeText } });
    const { result } = renderHook(() => useCopyToClipboard());
    await act(async () => {
      await result.current.copy('text');
    });
    expect(result.current.status).toBe('error');
  });

  it('transitions to error when clipboard API is unavailable', async () => {
    // Simulate environments without clipboard support (older browsers, sandboxed iframes).
    Object.assign(navigator, { clipboard: undefined });
    const { result } = renderHook(() => useCopyToClipboard());
    await act(async () => {
      await result.current.copy('text');
    });
    expect(result.current.status).toBe('error');
  });

  it('reset() returns to idle immediately and cancels the auto-reset', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const { result } = renderHook(() => useCopyToClipboard());
    await act(async () => {
      await result.current.copy('x');
    });
    expect(result.current.status).toBe('copied');
    act(() => {
      result.current.reset();
    });
    expect(result.current.status).toBe('idle');
  });

  it('does not throw when unmounted before the auto-reset timer fires', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const { result, unmount } = renderHook(() => useCopyToClipboard());
    await act(async () => {
      await result.current.copy('x');
    });
    unmount();
    expect(() => {
      vi.advanceTimersByTime(2000);
    }).not.toThrow();
  });

  it('successive copies cancel the prior auto-reset (timer is debounced to latest)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const { result } = renderHook(() => useCopyToClipboard());
    await act(async () => {
      await result.current.copy('a');
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.status).toBe('copied');
    await act(async () => {
      await result.current.copy('b');
    });
    act(() => {
      vi.advanceTimersByTime(1499);
    });
    expect(result.current.status).toBe('copied');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.status).toBe('idle');
  });
});
