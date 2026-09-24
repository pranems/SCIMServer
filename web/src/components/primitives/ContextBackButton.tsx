import React from 'react';
import { Button } from '@fluentui/react-components';
import { ArrowLeft24Regular } from '@fluentui/react-icons';
import { useCanGoBack, useRouter } from '@tanstack/react-router';

export interface ContextBackButtonProps {
  onFallback: () => void;
  label?: string;
  'data-testid'?: string;
}

export function useContextBack(onFallback: () => void): () => void {
  const canGoBack = useCanGoBack();
  const router = useRouter();

  return () => {
    if (canGoBack) {
      router.history.back();
      return;
    }
    onFallback();
  };
}

export const ContextBackButton: React.FC<ContextBackButtonProps> = ({
  onFallback,
  label = 'Back',
  'data-testid': testId = 'context-back-button',
}) => {
  const goBack = useContextBack(onFallback);

  return (
    <Button
      appearance="subtle"
      icon={<ArrowLeft24Regular />}
      onClick={goBack}
      data-testid={testId}
    >
      {label}
    </Button>
  );
};
