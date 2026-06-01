import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { CopyableJsonBlock } from './CopyableJsonBlock';

const renderWithFluent = (ui: React.ReactElement): ReturnType<typeof render> =>
  render(<FluentProvider theme={webLightTheme}>{ui}</FluentProvider>);

describe('CopyableJsonBlock', () => {
  const writeText = vi.fn();
  beforeEach(() => {
    writeText.mockReset();
    Object.assign(navigator, { clipboard: { writeText, readText: vi.fn() } });
  });

  it('renders the value as pretty-printed JSON inside a <pre>', () => {
    const value = { a: 1, nested: { b: 2 } };
    renderWithFluent(<CopyableJsonBlock value={value} data-testid="blk" />);
    const pre = screen.getByTestId('blk-pre');
    expect(pre.tagName).toBe('PRE');
    expect(JSON.parse(pre.textContent ?? '{}')).toEqual(value);
    expect(pre.textContent).toContain('\n  "a"');
  });

  it('renders the optional label in the header', () => {
    renderWithFluent(
      <CopyableJsonBlock value={{ x: 1 }} label="name" data-testid="blk" />,
    );
    expect(screen.getByText('name')).toBeInTheDocument();
  });

  it('header copy button writes the JSON to clipboard', () => {
    const value = { schemas: ['core'], displayName: 'X' };
    renderWithFluent(<CopyableJsonBlock value={value} data-testid="blk" />);
    fireEvent.click(screen.getByTestId('blk-copy-button'));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(JSON.parse(writeText.mock.calls[0][0] as string)).toEqual(value);
  });

  it('handles null + undefined values without crashing', () => {
    renderWithFluent(<CopyableJsonBlock value={null} data-testid="blk1" />);
    expect(screen.getByTestId('blk1-pre').textContent).toBe('null');
    renderWithFluent(<CopyableJsonBlock value={undefined} data-testid="blk2" />);
    expect(screen.getByTestId('blk2-pre').textContent).toBe('null');
  });

  it('honors the indent + maxHeight overrides', () => {
    renderWithFluent(
      <CopyableJsonBlock value={{ x: 1 }} indent={4} maxHeight="80px" data-testid="blk" />,
    );
    const pre = screen.getByTestId('blk-pre');
    expect(pre.textContent).toContain('\n    "x"');
    expect((pre as HTMLElement).style.maxHeight).toBe('80px');
  });
});
