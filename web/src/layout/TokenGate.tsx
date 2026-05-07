/**
 * TokenGate - Fluent UI token entry dialog.
 *
 * Shows a modal dialog when no auth token is stored in localStorage.
 * Once the user enters a token, it's saved and all TanStack Query
 * caches are invalidated to trigger data fetches.
 *
 * Also listens for TOKEN_INVALID_EVENT (401 from API) to re-show the dialog.
 */
import React, { useState, useEffect, useCallback } from 'react';
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
  const [showDialog, setShowDialog] = useState(!getStoredToken());
  const [tokenValue, setTokenValue] = useState('');
  const [error, setError] = useState('');

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
    const trimmed = tokenValue.trim();
    if (!trimmed) {
      setError('Token cannot be empty.');
      return;
    }
    setStoredToken(trimmed);
    setShowDialog(false);
    setError('');
    setTokenValue('');
    // Invalidate all queries so they refetch with the new token
    queryClient.invalidateQueries();
  }, [tokenValue, queryClient]);

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
