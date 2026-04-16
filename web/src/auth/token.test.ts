import { describe, it, expect, beforeEach } from 'vitest';
import {
  TOKEN_STORAGE_KEY,
  getStoredToken,
  setStoredToken,
  clearStoredToken,
} from './token';

describe('token', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when no token stored', () => {
    expect(getStoredToken()).toBeNull();
  });

  it('stores and retrieves a token', () => {
    setStoredToken('my-secret');
    expect(getStoredToken()).toBe('my-secret');
  });

  it('trims whitespace from tokens', () => {
    setStoredToken('  padded-token  ');
    expect(getStoredToken()).toBe('padded-token');
  });

  it('clears the stored token', () => {
    setStoredToken('to-delete');
    expect(getStoredToken()).toBe('to-delete');
    clearStoredToken();
    expect(getStoredToken()).toBeNull();
  });

  it('uses the correct storage key', () => {
    setStoredToken('test-val');
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBe('test-val');
  });

  it('returns null for empty-string token in storage', () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, '   ');
    expect(getStoredToken()).toBeNull();
  });
});
