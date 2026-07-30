/**
 * OverflowMenu (X1) - the ONE uniform "More" overflow-menu control used across
 * the app. It standardizes the three-dot affordance the WIF-trust + credential
 * cards introduced (W7) so EVERY overflow menu looks + behaves identically:
 *
 *   - a `MoreHorizontal` three-dot icon PLUS a visible "More" text label, so it
 *     is unmistakably a clickable control (not a bare, ambiguous icon);
 *   - a hover/focus affordance (Fluent `subtle` Button) + a tooltip;
 *   - a stable `data-testid` on the trigger; the menu items are passed as
 *     children (Fluent `MenuItem`s).
 *
 * Usage:
 *   <OverflowMenu ariaLabel={`More actions for ${name}`} data-testid={`x-more-${id}`}>
 *     <MenuItem ...>Reveal</MenuItem>
 *     <MenuItem ...>Delete</MenuItem>
 *   </OverflowMenu>
 */
import * as React from 'react';
import {
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  Button,
  Tooltip,
} from '@fluentui/react-components';
import { MoreHorizontal20Regular } from '@fluentui/react-icons';

export interface OverflowMenuProps {
  /** Accessible label for the trigger (screen readers). */
  ariaLabel: string;
  /** Visible label next to the three-dot icon. Defaults to "More". */
  label?: string;
  /** Tooltip text. Defaults to "More actions". */
  tooltip?: string;
  /** The `MenuItem`s to render inside the popover. */
  children: React.ReactNode;
  'data-testid'?: string;
}

export const OverflowMenu: React.FC<OverflowMenuProps> = ({
  ariaLabel,
  label = 'More',
  tooltip = 'More actions',
  children,
  'data-testid': dataTestId,
}) => (
  <Menu>
    <MenuTrigger disableButtonEnhancement>
      <Tooltip content={tooltip} relationship="label" positioning="above">
        <Button
          appearance="subtle"
          icon={<MoreHorizontal20Regular />}
          iconPosition="before"
          aria-label={ariaLabel}
          data-testid={dataTestId}
        >
          {label}
        </Button>
      </Tooltip>
    </MenuTrigger>
    <MenuPopover>
      <MenuList>{children}</MenuList>
    </MenuPopover>
  </Menu>
);
