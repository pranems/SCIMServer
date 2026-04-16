import React from 'react';
import { useTheme } from '../hooks/useTheme';
import styles from './Header.module.css';

interface HeaderProps {
  onChangeToken: () => void;
  tokenConfigured: boolean;
}

export const Header: React.FC<HeaderProps> = ({ onChangeToken, tokenConfigured }) => {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className={styles.header}>
      <div className={styles.container}>
        <div className={styles.brand}>
          <div className={styles.logo}>
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <rect width="28" height="28" rx="4" fill="var(--color-primary)" />
              <path
                d="M8 11h12M8 15h8M8 19h10"
                stroke="white"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div className={styles.brandText}>
            <h1 className={styles.title}>SCIMServer</h1>
            <p className={styles.subtitle}>SCIM 2.0 Provisioning Monitor</p>
          </div>
        </div>

        <div className={styles.actions}>
          <div className={styles.status}>
            <div className={styles.statusIndicator}>
              <div className={styles.statusDot}></div>
              <span className={styles.statusText}>Active</span>
            </div>

            {!tokenConfigured && (
              <span className={styles.tokenStatus}>Token required</span>
            )}
          </div>

          <button
            className={styles.tokenButton}
            onClick={onChangeToken}
            title={tokenConfigured ? 'Update SCIM bearer token' : 'Set SCIM bearer token'}
          >
            {tokenConfigured ? 'Change Token' : 'Set Token'}
          </button>

          <button
            className={styles.themeToggle}
            onClick={toggleTheme}
            title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
          >
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
        </div>
      </div>
    </header>
  );
};