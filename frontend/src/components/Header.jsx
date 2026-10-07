import { memo } from 'react';
import { useTheme } from '../hooks/useTheme';
import ConnectionStatus from './ConnectionStatus';
import './Header.css';

function Header({
  wsStatus,
  sessions = [],
  activeSession,
  activeCircuit,
  onSwitchRace,
  currentPoint,
}) {
  const { theme, toggleTheme } = useTheme();

  const flag = currentPoint?.flag || 'GREEN';
  const sc = currentPoint?.safety_car || 'NONE';
  const isSc = sc !== 'NONE';

  const flagColor =
    flag === 'GREEN'
      ? '#22c55e'
      : flag === 'YELLOW'
      ? '#eab308'
      : flag === 'RED'
      ? '#ef4444'
      : '#38bdf8';

  return (
    <header className="header" id="app-header">
      <div className="header__inner">
        {/* Brand Group */}
        <div className="header__brand">
          <div className="header__logo-container" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="30" height="30" fill="none">
              <rect width="32" height="32" rx="6" fill="#e10600" />
              <path d="M6 10h20v3H6z" fill="#fff" />
              <path d="M6 15h15v3H6z" fill="#fff" opacity="0.9" />
              <path d="M6 20h10v3H6z" fill="#fff" opacity="0.75" />
            </svg>
          </div>
          <div className="header__title-group">
            <div className="header__headline">
              <h1 className="header__title font-heading">APEX PITWALL</h1>
              <span className="header__live-tag font-mono">LIVE 60Hz</span>
            </div>
            <span className="header__subtitle">F1 Telemetry Broadcast & Race Control</span>
          </div>
        </div>

        {/* Center: Grand Prix Race Switcher */}
        <div className="header__race-selector">
          <label htmlFor="grand-prix-select" className="race-selector__label font-mono">
            RACE EVENT:
          </label>
          <div className="race-selector__select-wrapper">
            <select
              id="grand-prix-select"
              className="race-selector__select font-heading"
              value={
                activeSession
                  ? `${activeSession.year}|${activeSession.round}|${activeSession.session_type}`
                  : ''
              }
              onChange={(e) => {
                const val = e.target.value;
                const match = sessions.find(
                  (s) => `${s.year}|${s.round}|${s.session_type}` === val
                );
                if (match && onSwitchRace) {
                  onSwitchRace(match);
                }
              }}
            >
              {sessions.map((s) => {
                const key = `${s.year}|${s.round}|${s.session_type}`;
                const label = `${s.year} R${s.round} — ${s.event_name} (${s.session_type})`;
                return (
                  <option key={key} value={key}>
                    {label}
                  </option>
                );
              })}
            </select>
            <span className="race-selector__arrow" aria-hidden="true">▼</span>
          </div>
          {activeCircuit && (
            <span className="race-selector__location font-mono">
              {activeCircuit.location || activeCircuit.name}
            </span>
          )}
        </div>

        {/* Right: FIA Track Status & Controls */}
        <div className="header__controls">
          {/* Track Condition Indicator */}
          <div
            className="header__track-flag font-mono"
            style={{
              borderColor: isSc ? '#f59e0b' : flagColor,
              backgroundColor: isSc ? 'rgba(245, 158, 11, 0.15)' : `${flagColor}1a`,
              color: isSc ? '#f59e0b' : flagColor,
            }}
          >
            <span
              className="track-flag__dot"
              style={{ backgroundColor: isSc ? '#f59e0b' : flagColor }}
            ></span>
            <span>{isSc ? `SAFETY CAR (${sc})` : `TRACK ${flag}`}</span>
          </div>

          <ConnectionStatus status={wsStatus} />

          {/* Theme Toggle */}
          <button
            className="header__theme-toggle"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            id="theme-toggle"
          >
            {theme === 'dark' ? (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}

export default memo(Header);
