import { useState, useCallback } from 'react';
import './SessionSelector.css';

export default function SessionSelector({ sessions, onSelect, loading, activeSession }) {
  const [showCustom, setShowCustom] = useState(false);
  const [year, setYear] = useState('2023');
  const [race, setRace] = useState('Monaco');
  const [sessionType, setSessionType] = useState('Q');
  const [driver, setDriver] = useState('VER');

  const toggleCustom = useCallback(() => {
    setShowCustom((prev) => !prev);
  }, []);

  const handleChange = useCallback((e) => {
    const val = e.target.value;
    if (!val) return;

    const parts = val.split('|');
    if (parts.length < 3) return;

    const y = Number(parts[0]);
    const r = Number(parts[1]);
    const sType = parts[2];
    const drv = parts[3] || undefined;

    if (Number.isNaN(y) || Number.isNaN(r) || !sType) return;

    onSelect(y, r, sType, drv);
  }, [onSelect]);

  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    if (!year || !race || !sessionType) return;
    onSelect(Number(year), race, sessionType, driver || undefined);
  }, [year, race, sessionType, driver, onSelect]);

  const value = activeSession
    ? `${activeSession.year}|${activeSession.round}|${activeSession.session_type}|${activeSession.driver || ''}`
    : '';

  return (
    <div className="session-selector-container" id="session-selector-container">
      <div className="session-selector" id="session-selector">
        <label className="session-selector__label" htmlFor="session-select">
          Cached Session
        </label>
        <div className="session-selector__wrapper">
          <select
            id="session-select"
            className="session-selector__select"
            onChange={handleChange}
            disabled={loading}
            value={value}
          >
            <option value="" disabled>
              {sessions.length === 0 ? 'No sessions available' : 'Select a session…'}
            </option>
            {sessions.map((s) => {
              const driverStr = s.driver ? ` - ${s.driver}` : '';
              const key = `${s.year}|${s.round}|${s.session_type}|${s.driver || ''}`;
              const label = s.event_name
                ? `${s.year} Round ${s.round} — ${s.event_name} (${s.session_type}${driverStr})`
                : `${s.year} Round ${s.round} — ${s.session_type}${driverStr}`;
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

        <button
          type="button"
          className={`session-selector__toggle-btn ${showCustom ? 'session-selector__toggle-btn--active' : ''}`}
          onClick={toggleCustom}
          aria-expanded={showCustom}
          aria-controls="custom-query-form"
          id="toggle-custom-query"
        >
          {showCustom ? 'Hide Query Panel' : 'Query Live/Custom Session'}
        </button>
      </div>

      {showCustom && (
        <form
          id="custom-query-form"
          className="session-selector__form"
          onSubmit={handleSubmit}
        >
          <div className="session-selector__form-group">
            <label htmlFor="custom-year">Year</label>
            <input
              id="custom-year"
              type="number"
              min="1950"
              max="2099"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              disabled={loading}
              required
              className="session-selector__input"
            />
          </div>

          <div className="session-selector__form-group">
            <label htmlFor="custom-race">Race / Round</label>
            <input
              id="custom-race"
              type="text"
              placeholder="e.g. Monaco or 6"
              value={race}
              onChange={(e) => setRace(e.target.value)}
              disabled={loading}
              required
              className="session-selector__input"
            />
          </div>

          <div className="session-selector__form-group">
            <label htmlFor="custom-session">Session</label>
            <select
              id="custom-session"
              value={sessionType}
              onChange={(e) => setSessionType(e.target.value)}
              disabled={loading}
              className="session-selector__input session-selector__select-input"
            >
              <option value="FP1">FP1</option>
              <option value="FP2">FP2</option>
              <option value="FP3">FP3</option>
              <option value="Q">Qualifying (Q)</option>
              <option value="S">Sprint (S)</option>
              <option value="SQ">Sprint Shootout (SQ)</option>
              <option value="SS">Sprint Showdown (SS)</option>
              <option value="R">Race (R)</option>
            </select>
          </div>

          <div className="session-selector__form-group">
            <label htmlFor="custom-driver">Driver</label>
            <input
              id="custom-driver"
              type="text"
              placeholder="e.g. VER"
              maxLength="3"
              value={driver}
              onChange={(e) => setDriver(e.target.value.toUpperCase())}
              disabled={loading}
              className="session-selector__input"
            />
          </div>

          <button
            type="submit"
            className="session-selector__submit-btn"
            disabled={loading}
            id="submit-custom-query"
          >
            {loading ? 'Fetching...' : 'Query Session'}
          </button>
        </form>
      )}
    </div>
  );
}
