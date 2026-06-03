/**
 * TokenGate - Fluent UI token entry dialog.
 *
 * Shows a modal dialog when no auth token is stored in localStorage.
 * Once the user enters a token, it's saved and all TanStack Query
 * caches are invalidated to trigger data fetches.
 *
 * Also listens for TOKEN_INVALID_EVENT (401 from API) to re-show the dialog.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Input,
  Button,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { Key24Regular } from '@fluentui/react-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import {
  getStoredToken,
  setStoredToken,
  TOKEN_INVALID_EVENT,
} from '../auth/token';

const useStyles = makeStyles({
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
});

export const TokenGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const classes = useStyles();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [showDialog, setShowDialog] = useState(!getStoredToken());
  const [tokenValue, setTokenValue] = useState('');
  const [error, setError] = useState('');
  const [isPending, setIsPending] = useState(false);
  // Ref-backed guard for synchronous double-click protection. React state
  // updates are batched, so two fireEvent.click() in the same tick both see
  // isPending===false. The ref flips synchronously inside the first call
  // and short-circuits the second.
  const pendingRef = useRef(false);

  // Listen for 401 token-invalid events from fetchWithAuth
  useEffect(() => {
    const handler = () => {
      setShowDialog(true);
      setError('Token expired or invalid. Please enter a new token.');
    };
    window.addEventListener(TOKEN_INVALID_EVENT, handler);
    return () => window.removeEventListener(TOKEN_INVALID_EVENT, handler);
  }, []);

  const handleSave = useCallback(() => {
    if (pendingRef.current) return; // synchronous double-click guard
    const trimmed = tokenValue.trim();
    if (!trimmed) {
      setError('Token cannot be empty.');
      return;
    }
    pendingRef.current = true;
    setIsPending(true);
    setStoredToken(trimmed);
    setShowDialog(false);
    setError('');
    setTokenValue('');
    // Invalidate all TanStack Query cache entries so they refetch with
    // the new token.
    queryClient.invalidateQueries();
    // Re-run all active TanStack Router loaders. Without this the route
    // stays in the error state produced by the pre-authentication loader
    // run (which threw 401 because there was no token yet) and the user
    // sees "Something went wrong" immediately after saving the token
    // (Bug 3 of the post-token-save error-screen RCA 2026-05-20).
    router.invalidate();
    // Clear pending after router operations have been queued
    setTimeout(() => {
      pendingRef.current = false;
      setIsPending(false);
    }, 0);
  }, [tokenValue, queryClient, router]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleSave();
    },
    [handleSave],
  );


  if (showDialog) {
    return (
      <Dialog open modalType="alert">
        <DialogSurface>
          <DialogBody>
            <DialogTitle>
              <Key24Regular style={{ marginRight: 8, verticalAlign: 'middle' }} />
              Authentication Required
            </DialogTitle>
            <DialogContent className={classes.content}>
              <Text>
                Enter the bearer token configured on the SCIMServer instance.
                This is the value of the <code>SCIM_SHARED_SECRET</code> environment variable.
              </Text>
              {error && (
                <Text style={{ color: tokens.colorPaletteRedForeground1 }}>
                  {error}
                </Text>
              )}
              <Input
                type="password"
                placeholder="S3cret-Value"
                value={tokenValue}
                onChange={(_, d) => setTokenValue(d.value)}
                onKeyDown={handleKeyDown}
                autoFocus
                data-testid="token-input"
                style={{ width: '100%' }}
              />
              <Text size={200} className={classes.hint}>
                For dev: <code>changeme-scim</code> | For local: <code>local-secret</code>
              </Text>
            </DialogContent>
            <DialogActions>
              <Button
                appearance="primary"
                onClick={handleSave}
                disabled={isPending}
                data-testid="token-save"
              >
                Save Token
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    );
  }

  return <>{children}</>;
};
