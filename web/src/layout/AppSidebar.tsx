/**
 * AppSidebar - collapsible navigation sidebar using Fluent UI Nav.
 *
 * @see docs/UI_REDESIGN_ARCHITECTURE_AND_PLAN.md D1 (hybrid layout)
 */
import React from 'react';
import {
  makeStyles,
  tokens,
  Text,
  Tooltip,
  Button,
} from '@fluentui/react-components';
import {
  Home24Regular,
  Server24Regular,
  DocumentText24Regular,
  Settings24Regular,
  PanelLeft24Regular,
  PanelLeftContract24Regular,
} from '@fluentui/react-icons';
import { SIDEBAR_WIDTH_EXPANDED, SIDEBAR_WIDTH_COLLAPSED, HEADER_HEIGHT } from '../design/tokens';
import { useUIStore } from '../store/ui-store';

const useStyles = makeStyles({
  sidebar: {
    display: 'flex',
    flexDirection: 'column',
    height: `calc(100vh - ${HEADER_HEIGHT})`,
    backgroundColor: tokens.colorNeutralBackground2,
    borderRight: `1px solid ${tokens.colorNeutralStroke1}`,
    transition: 'width 0.2s ease',
    overflow: 'hidden',
    flexShrink: 0,
  },
  expanded: { width: SIDEBAR_WIDTH_EXPANDED },
  collapsed: { width: SIDEBAR_WIDTH_COLLAPSED },
  nav: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: '8px',
    flex: 1,
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px 12px',
    borderRadius: tokens.borderRadiusMedium,
    cursor: 'pointer',
    color: tokens.colorNeutralForeground2,
    textDecoration: 'none',
    whiteSpace: 'nowrap',
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
      color: tokens.colorNeutralForeground1,
    },
  },
  navItemActive: {
    backgroundColor: tokens.colorNeutralBackground1Selected,
    color: tokens.colorBrandForeground1,
  },
  collapseBtn: {
    margin: '8px',
    alignSelf: 'flex-end',
  },
});

interface NavItem {
  key: string;
  label: string;
  icon: React.ReactElement;
  href: string;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', icon: <Home24Regular />, href: '/' },
  { key: 'endpoints', label: 'Endpoints', icon: <Server24Regular />, href: '/endpoints' },
  { key: 'logs', label: 'Logs', icon: <DocumentText24Regular />, href: '/logs' },
  { key: 'settings', label: 'Settings', icon: <Settings24Regular />, href: '/settings' },
];

export const AppSidebar: React.FC = () => {
  const classes = useStyles();
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const currentPath = useUIStore((s) => s.currentPath);
  const navigate = useUIStore((s) => s.navigate);

  // Derive active route from store path
  const activeKey = NAV_ITEMS.find(
    (item) => item.href === '/' ? currentPath === '/' : currentPath.startsWith(item.href),
  )?.key ?? 'dashboard';

  return (
    <nav
      className={`${classes.sidebar} ${collapsed ? classes.collapsed : classes.expanded}`}
      data-testid="app-sidebar"
      aria-label="Main navigation"
    >
      <div className={classes.nav}>
        {NAV_ITEMS.map((item) => {
          const isActive = item.key === activeKey;
          const link = (
            <a
              key={item.key}
              href={item.href}
              onClick={(e) => {
                e.preventDefault();
                navigate(item.href);
              }}
              className={`${classes.navItem} ${isActive ? classes.navItemActive : ''}`}
              aria-current={isActive ? 'page' : undefined}
            >
              {item.icon}
              {!collapsed && <Text size={300}>{item.label}</Text>}
            </a>
          );

          return collapsed ? (
            <Tooltip key={item.key} content={item.label} relationship="label" positioning="after">
              {link}
            </Tooltip>
          ) : (
            link
          );
        })}
      </div>

      <Button
        className={classes.collapseBtn}
        appearance="subtle"
        icon={collapsed ? <PanelLeft24Regular /> : <PanelLeftContract24Regular />}
        onClick={toggleSidebar}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        data-testid="sidebar-toggle"
      />
    </nav>
  );
};
