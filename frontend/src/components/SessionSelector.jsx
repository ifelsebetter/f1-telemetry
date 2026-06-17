import { useCallback } from 'react';
import './SessionSelector.css';

export default function SessionSelector({ sessions, onSelect, loading }) {
  const handleChange = useCallback((e) => {
    const value = e.target.value;
    if (!value) return;

    const parts = value.split('|');
    if (parts.length < 3) return;

    const year = Number(parts[0]);
    const round = Number(parts[1]);
    // Rejoin remaining parts in case session_type somehow contained '|'
    const sessionType = parts.slice(2).join('|');

    if (Number.isNaN(year) || Number.isNaN(round) || !sessionType) return;

    onSelect(year, round, sessionType);
  }, [onSelect]);

  return (
    <div className="session-selector" id="session-selector">
      <label className="session-selector__label" htmlFor="session-select">
        Session
      </label>
      <div className="session-selector__wrapper">
        <select
          id="session-select"
          className="session-selector__select"
          onChange={handleChange}
          disabled={loading}
          defaultValue=""
        >
          <option value="" disabled>
            {sessions.length === 0 ? 'No sessions available' : 'Select a session…'}
          </option>
          {sessions.map((s) => {
            const key = `${s.year}|${s.round}|${s.session_type}`;
            const label = s.event_name
              ? `${s.year} Round ${s.round} — ${s.event_name} (${s.session_type})`
              : `${s.year} Round ${s.round} — ${s.session_type}`;
            return (
              <option key={key} value={key}>
                {label}
              </option>
            );
          })}
        </select>
        <svg className="session-selector__chevron" viewBox="0 0 20 20" width="16" height="16" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </div>
    </div>
  );
}
