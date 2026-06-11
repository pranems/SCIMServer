/**
 * DetailDrawer - right-side overlay drawer used by tabs that need a
 * contextual detail panel (Activity drawer, Credential drawer, etc.).
 *
 * Wraps Fluent UI's `OverlayDrawer` so callers don't have to wire up
 * `position`, `type`, `onOpenChange`, ESC handling or backdrop clicks
 * - the drawer Just Closes when the user expects it to.
 *
 * Slot conventions:
 *   - `title`: short string for the sticky header (also drives aria-label)
 *   - `children`: scrollable body
 *   - `footer`: optional action bar pinned to the bottom
 *
 * @see docs/UI_REDESIGN_REMAINING_GAPS_PLAN.md Phase C1
 */
import React from 'react';
import {
  OverlayDrawer,
  DrawerHeader,
  DrawerHeaderTitle,
  DrawerBody,
  DrawerFooter,
  Button,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { Dismiss24Regular } from '@fluentui/react-icons';

const useStyles = makeStyles({
  body: {
    paddingTop: '8px',
    paddingBottom: '8px',
    // CRITICAL (Finding-D #3, 2026-05-29): the drawer width is fixed
    // by the caller. Without these guards a single oversized child
    // (long monospace token, wide table) pushes the entire drawer
    // body horizontally, hiding content off the left edge. minWidth:0
    // is the canonical flex-child shrink fix; overflowX:hidden makes
    // it explicit. Vertical scroll stays - it is the intended axis.
    minWidth: 0,
    maxWidth: '100%',
    overflowX: 'hidden',
  },
  footer: {
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    paddingTop: '12px',
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
  },
});

export interface DetailDrawerProps {
  /** Whether the drawer is open. Controlled externally. */
  open: boolean;
  /** Called when the drawer wants to close (ESC, backdrop, X button). */
  onClose: () => void;
  /** Sticky header text. Also used as the accessible name. */
  title: string;
  /** Drawer width (CSS length). Default 480px. */
  width?: string;
  /** Body content - rendered in a scroll container. */
  children: React.ReactNode;
  /** Optional sticky footer slot - typically action buttons. */
  footer?: React.ReactNode;
  /** Override the default test id. */
  'data-testid'?: string;
}

export const DetailDrawer: React.FC<DetailDrawerProps> = ({
  open,
  onClose,
  title,
  width = '480px',
  children,
  footer,
  ...rest
}) => {
  const classes = useStyles();
  const testId = rest['data-testid'] ?? 'detail-drawer';

  return (
    <OverlayDrawer
      open={open}
      onOpenChange={(_, data) => {
        // Fluent fires { open: false } for ESC, backdrop click, and the
        // close button alike. We collapse all of those into onClose so
        // the parent doesn't have to distinguish them.
        if (!data.open) onClose();
      }}
      position="end"
      style={{ width }}
      data-testid={testId}
      aria-label={title}
    >
      <DrawerHeader>
        <DrawerHeaderTitle
          action={
            <Button
              appearance="subtle"
              aria-label="Close drawer"
              icon={<Dismiss24Regular />}
              onClick={onClose}
              data-testid={`${testId}-close`}
            />
          }
          data-testid={`${testId}-title`}
        >
          {title}
        </DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody className={classes.body} data-testid={`${testId}-body`}>
        {children}
      </DrawerBody>
      {footer !== undefined && (
        <DrawerFooter className={classes.footer} data-testid={`${testId}-footer`}>
          {footer}
        </DrawerFooter>
      )}
    </OverlayDrawer>
  );
};
