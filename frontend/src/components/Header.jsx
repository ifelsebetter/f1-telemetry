import { memo, useState, useEffect } from 'react';
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
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customYear, setCustomYear] = useState(2023);
  const [customRound, setCustomRound] = useState(1);
  const [customType, setCustomType] = useState('R');

  useEffect(() => {
    if (!showCustomForm) return undefined;
    const handleEsc = (e) => {
      if (e.key === 'Escape') {
        setShowCustomForm(false);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [showCustomForm]);

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

  const handleLoadCustom = (e) => {
    e.preventDefault();
    if (!onSwitchRace) return;
    const roundMap = {
      1: { name: 'Bahrain Grand Prix', circuit: 'bahrain' },
      6: { name: 'Monaco Grand Prix', circuit: 'monaco' },
      10: { name: 'British Grand Prix', circuit: 'silverstone' },
      12: { name: 'Belgian Grand Prix', circuit: 'spa' },
      14: { name: 'Italian Grand Prix', circuit: 'monza' },
      16: { name: 'Japanese Grand Prix', circuit: 'suzuka' },
      20: { name: 'São Paulo Grand Prix', circuit: 'interlagos' },
    };
    const meta = roundMap[customRound] || {
      name: `Round ${customRound} Grand Prix`,
      circuit: 'bahrain',
    };
    onSwitchRace({
      year: Number(customYear),
      round: Number(customRound),
      session_type: customType,
      event_name: `${meta.name} (${customType})`,
      circuit_id: meta.circuit,
    });
    setShowCustomForm(false);
  };

  const activeSelectValue = activeSession
    ? `${activeSession.year}|${activeSession.round}|${activeSession.session_type}`
    : '';
  const hasPresetMatch = sessions.some(
    (s) => `${s.year}|${s.round}|${s.session_type}` === activeSelectValue
  );

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
              <span className="header__live-tag font-mono">20Hz STREAM • 60FPS</span>
            </div>
            <span className="header__subtitle">F1 Telemetry Broadcast & Race Control</span>
          </div>
        </div>

        {/* Center: Grand Prix Race Switcher + Custom Session Loader */}
        <div className="header__race-group">
          <div className="header__race-selector">
            <label htmlFor="grand-prix-select" className="race-selector__label font-mono">
              RACE EVENT:
            </label>
            <div className="race-selector__select-wrapper">
              <select
                id="grand-prix-select"
                className="race-selector__select font-heading"
                value={activeSelectValue}
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
                {!hasPresetMatch && activeSession && (
                  <option value={activeSelectValue}>
                    {`${activeSession.year} R${activeSession.round} — ${activeSession.event_name}`}
                  </option>
                )}
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
              <span className="race-selector__arrow" aria-hidden="true">
                <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="2.5 4.5 6 8 9.5 4.5" />
                </svg>
              </span>
            </div>
            {activeCircuit && (
              <span className="race-selector__location font-mono">
                {activeCircuit.location || activeCircuit.name}
              </span>
            )}
            <button
              type="button"
              className={`header__custom-btn font-mono ${showCustomForm ? 'active' : ''}`}
              onClick={() => setShowCustomForm((prev) => !prev)}
              aria-expanded={showCustomForm}
              title="Load custom FastF1 Year / Round / Session"
            >
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="2" y1="4" x2="14" y2="4" />
                <line x1="2" y1="8" x2="14" y2="8" />
                <line x1="2" y1="12" x2="14" y2="12" />
                <circle cx="5" cy="4" r="1.5" fill="currentColor" />
                <circle cx="10" cy="8" r="1.5" fill="currentColor" />
                <circle cx="7" cy="12" r="1.5" fill="currentColor" />
              </svg>
              <span>CUSTOM GP</span>
            </button>
          </div>

          {showCustomForm && (
            <form className="header__custom-form font-mono" onSubmit={handleLoadCustom}>
              <label className="custom-form__field">
                <span>YEAR</span>
                <select value={customYear} onChange={(e) => setCustomYear(Number(e.target.value))}>
                  {[2024, 2023, 2022, 2021].map((yr) => (
                    <option key={yr} value={yr}>{yr}</option>
                  ))}
                </select>
              </label>
              <label className="custom-form__field">
                <span>RND</span>
                <input
                  type="number"
                  min="1"
                  max="24"
                  value={customRound}
                  onChange={(e) => setCustomRound(Number(e.target.value))}
                />
              </label>
              <label className="custom-form__field">
                <span>TYPE</span>
                <select value={customType} onChange={(e) => setCustomType(e.target.value)}>
                  <option value="R">Race (R)</option>
                  <option value="Q">Quali (Q)</option>
                  <option value="S">Sprint (S)</option>
                  <option value="FP1">FP1</option>
                </select>
              </label>
              <button type="submit" className="custom-form__submit">
                LOAD
              </button>
            </form>
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
            type="button"
            className="header__theme-toggle"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            id="theme-toggle"
          >
            {theme === 'dark' ? (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
