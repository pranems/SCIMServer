import React, { useMemo, useState, useEffect } from 'react';
import styles from './DatabaseBrowser.module.css';

interface Statistics {
  users: {
    total: number;
    active: number;
    inactive: number;
  };
  groups: {
    total: number;
  };
  activity: {
    totalRequests: number;
    last24Hours: number;
  };
  database?: {
    type: string;
    persistenceBackend: 'prisma' | 'inmemory';
  };
}

interface StatisticsTabProps {
  statistics: Statistics | null;
  loading: boolean;
  lastUpdated?: Date | null;
  onRefresh?: () => void;
  onNavigate?: (tab: 'users' | 'groups', filter?: string) => void;
}

// Ticking relative-time display that updates every 10s
const RelativeTime: React.FC<{ date: Date }> = ({ date }) => {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 10000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  let label: string;
  if (seconds < 5) label = 'just now';
  else if (seconds < 60) label = `${seconds}s ago`;
  else label = `${Math.floor(seconds / 60)}m ago`;
  return <span>Updated {label}</span>;
};

const StatisticsTabInner: React.FC<StatisticsTabProps> = ({
  statistics,
  loading,
  lastUpdated,
  onRefresh,
  onNavigate,
}) => {
  if (loading && !statistics) {
    return (
      <div className={styles.tabContent}>
        <div className={styles.loading}>Loading statistics...</div>
      </div>
    );
  }

  if (!statistics) {
    return (
      <div className={styles.tabContent}>
        <div className={styles.error}>Failed to load statistics</div>
      </div>
    );
  }

  const formatNumber = useMemo(() => {
    const fmt = new Intl.NumberFormat();
    return (n: number) => fmt.format(n);
  }, []);

  const activePercent = statistics.users.total > 0
    ? Math.round((statistics.users.active / statistics.users.total) * 100)
    : 0;

  const avgRequestsPerHour = Math.round(statistics.activity.last24Hours / 24);

  return (
    <div className={styles.tabContent}>
      {/* Refresh bar */}
      <div className={styles.statsHeader}>
        <div className={styles.refreshInfo}>
          {lastUpdated && <RelativeTime date={lastUpdated} />}
          {loading && <span>Refreshing...</span>}
        </div>
        {onRefresh && (
          <button className={styles.refreshButton} onClick={onRefresh} disabled={loading}>
            🔄 Refresh
          </button>
        )}
      </div>

      <div className={styles.statisticsGrid}>
        {/* Users Card */}
        <div className={styles.statCard}>
          <div className={styles.statHeader}>
            <h3>👥 Users</h3>
          </div>
          <div className={styles.statContent}>
            <div
              className={`${styles.statMain} ${onNavigate ? styles.statClickable : ''}`}
              onClick={() => onNavigate?.('users')}
              title="View all users"
            >
              <span className={styles.statNumber}>{formatNumber(statistics.users.total)}</span>
              <span className={styles.statLabel}>Total Users</span>
            </div>
            <div className={styles.statBreakdown}>
              <div
                className={`${styles.statItem} ${styles.statItemActive} ${onNavigate ? styles.statClickable : ''}`}
                onClick={() => onNavigate?.('users', 'true')}
                title="View active users"
              >
                <span className={styles.statValue}>{formatNumber(statistics.users.active)}</span>
                <span className={styles.statLabelSmall}>Active ({activePercent}%)</span>
              </div>
              <div
                className={`${styles.statItem} ${styles.statItemInactive} ${onNavigate ? styles.statClickable : ''}`}
                onClick={() => onNavigate?.('users', 'false')}
                title="View inactive users"
              >
                <span className={styles.statValue}>{formatNumber(statistics.users.inactive)}</span>
                <span className={styles.statLabelSmall}>Inactive</span>
              </div>
            </div>
          </div>
        </div>

        {/* Groups Card */}
        <div className={styles.statCard}>
          <div className={styles.statHeader}>
            <h3>🏢 Groups</h3>
          </div>
          <div className={styles.statContent}>
            <div
              className={`${styles.statMain} ${onNavigate ? styles.statClickable : ''}`}
              onClick={() => onNavigate?.('groups')}
              title="View all groups"
            >
              <span className={styles.statNumber}>{formatNumber(statistics.groups.total)}</span>
              <span className={styles.statLabel}>Total Groups</span>
            </div>
            {statistics.users.total > 0 && (
              <div className={styles.statBreakdown}>
                <div className={styles.statItem}>
                  <span className={styles.statValue}>
                    {(statistics.users.total / Math.max(statistics.groups.total, 1)).toFixed(1)}
                  </span>
                  <span className={styles.statLabelSmall}>Avg Users/Group</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Activity Card */}
        <div className={styles.statCard}>
          <div className={styles.statHeader}>
            <h3>📊 Activity</h3>
          </div>
          <div className={styles.statContent}>
            <div className={styles.statMain}>
              <span className={styles.statNumber}>{formatNumber(statistics.activity.totalRequests)}</span>
              <span className={styles.statLabel}>Total Requests</span>
            </div>
            <div className={styles.statBreakdown}>
              <div className={styles.statItem}>
                <span className={styles.statValue}>{formatNumber(statistics.activity.last24Hours)}</span>
                <span className={styles.statLabelSmall}>Last 24 Hours</span>
              </div>
              <div className={styles.statItem}>
                <span className={styles.statValue}>{formatNumber(avgRequestsPerHour)}</span>
                <span className={styles.statLabelSmall}>Avg/Hour</span>
              </div>
            </div>
          </div>
        </div>

        {/* Database Card */}
        <div className={styles.statCard}>
          <div className={styles.statHeader}>
            <h3>💾 Database</h3>
          </div>
          <div className={styles.statContent}>
            <div className={styles.statMain}>
              <span className={styles.statNumber}>{statistics.database?.type ?? 'PostgreSQL'}</span>
              <span className={styles.statLabel}>Database Type</span>
            </div>
            {statistics.database?.persistenceBackend === 'inmemory' && (
              <div className={styles.statNote}>
                ⚠️ Data is ephemeral - stored in memory only
              </div>
            )}
            {statistics.database?.persistenceBackend !== 'inmemory' && (
              <div className={styles.statBreakdown}>
                <div className={styles.statItem}>
                  <span className={styles.statValue}>{formatNumber(statistics.users.total + statistics.groups.total)}</span>
                  <span className={styles.statLabelSmall}>Total Resources</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// Memoize to avoid re-renders when parent state (users/groups lists) changes
export const StatisticsTab = React.memo(StatisticsTabInner);