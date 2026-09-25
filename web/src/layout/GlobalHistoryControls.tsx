import React from 'react';
import { Button, Tooltip, makeStyles } from '@fluentui/react-components';
import { ArrowLeft24Regular, ArrowRight24Regular } from '@fluentui/react-icons';
import { useRouter } from '@tanstack/react-router';
import { canGoForwardToIndex, getRouterHistoryIndex } from './router-history-index';

const useStyles = makeStyles({
  controls: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
  },
  button: {
    width: '32px',
    minWidth: '32px',
    height: '32px',
    color: 'inherit',
  },
});

interface HistoryAvailability {
  canGoBack: boolean;
  canGoForward: boolean;
}

export const GlobalHistoryControls: React.FC = () => {
  const classes = useStyles();
  const router = useRouter();
  const initialIndex = getRouterHistoryIndex(router.history.location.state);
  const highestReachableIndex = React.useRef(initialIndex);
  const [availability, setAvailability] = React.useState<HistoryAvailability>({
    canGoBack: router.history.canGoBack(),
    canGoForward: false,
  });

  React.useEffect(() => router.history.subscribe(({ location, action }) => {
    const currentIndex = getRouterHistoryIndex(location.state);
    if (action.type === 'PUSH') {
      // A new branch replaces every native forward entry.
      highestReachableIndex.current = currentIndex;
    } else {
      highestReachableIndex.current = Math.max(highestReachableIndex.current, currentIndex);
    }
    setAvailability({
      canGoBack: router.history.canGoBack(),
      canGoForward: canGoForwardToIndex(currentIndex, highestReachableIndex.current),
    });
  }), [router]);

  return (
    <div className={classes.controls} aria-label="Navigation history" data-testid="global-history-controls">
      <Tooltip content="Back" relationship="label">
        <Button
          className={classes.button}
          appearance="subtle"
          icon={<ArrowLeft24Regular />}
          aria-label="Back"
          data-testid="global-history-back"
          disabled={!availability.canGoBack}
          onClick={() => router.history.back()}
        />
      </Tooltip>
      <Tooltip content="Forward" relationship="label">
        <Button
          className={classes.button}
          appearance="subtle"
          icon={<ArrowRight24Regular />}
          aria-label="Forward"
          data-testid="global-history-forward"
          disabled={!availability.canGoForward}
          onClick={() => router.history.forward()}
        />
      </Tooltip>
    </div>
  );
};