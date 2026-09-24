import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { ContextBackButton, useContextBack } from './ContextBackButton';

const mockBack = vi.fn();
const mockFallback = vi.fn();
let canGoBack = true;

vi.mock('@tanstack/react-router', () => ({
  useCanGoBack: () => canGoBack,
  useRouter: () => ({ history: { back: mockBack } }),
}));

function Harness(): React.JSX.Element {
  const goBack = useContextBack(mockFallback);
  return <button onClick={goBack}>Hook back</button>;
}

function renderButton(): void {
  render(
    <FluentProvider theme={webLightTheme}>
      <ContextBackButton onFallback={mockFallback} data-testid="context-back" />
    </FluentProvider>,
  );
}

describe('ContextBackButton', () => {
  beforeEach(() => {
    canGoBack = true;
    vi.clearAllMocks();
  });

  it('uses router history when an in-app return entry exists', () => {
    renderButton();

    fireEvent.click(screen.getByTestId('context-back'));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockFallback).not.toHaveBeenCalled();
  });

  it('uses the safe fallback for a direct deep link', () => {
    canGoBack = false;
    renderButton();

    fireEvent.click(screen.getByTestId('context-back'));

    expect(mockFallback).toHaveBeenCalledTimes(1);
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('exposes the same behavior as a hook for post-save navigation', () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Hook back' }));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockFallback).not.toHaveBeenCalled();
  });
});
