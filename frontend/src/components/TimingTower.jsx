import { useState, memo } from 'react';
import './TimingTower.css';

function getCompoundBadge(compound) {
  const c = (compound || 'SOFT').toUpperCase();
  if (c.startsWith('S')) return { letter: 'S', color: '#ef4444', label: 'Soft' };
  if (c.startsWith('M')) return { letter: 'M', color: '#eab308', label: 'Medium' };
  if (c.startsWith('H')) return { letter: 'H', color: '#94a3b8', label: 'Hard' };
  if (c.startsWith('I')) return { letter: 'I', color: '#22c55e', label: 'Inter' };
  return { letter: 'W', color: '#3b82f6', label: 'Wet' };
}

function TimingTower({
  drivers = [],
  selectedDrivers = [],
  primaryDriver = 'VER',
  onToggleDriver,
  onSetPrimaryDriver,
  activeSession,
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [gapMode, setGapMode] = useState('gap'); // 'gap' | 'interval'

  return (
    <aside
      className={`timing-tower ${collapsed ? 'timing-tower--collapsed' : ''}`}
      id="timing-tower"
      aria-label="F1 Race Live Leaderboard"
    >
      {/* Tower Header */}
      <div className="tower__header">
        <div className="tower__header-left">
          <span className="tower__live-dot" aria-hidden="true"></span>
          <span className="tower__title font-heading">TIMING TOWER</span>
        </div>
        <div className="tower__header-right">
          <span className="tower__badge font-mono">{activeSession?.session_type || 'R'}</span>
          <button
            type="button"
            className="tower__collapse-btn"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand timing tower' : 'Collapse timing tower'}
            title={collapsed ? 'Expand timing tower' : 'Collapse timing tower'}
          >
            {collapsed ? (
              <svg viewBox="0 0 12 12" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="4.5 2.5 8 6 4.5 9.5" />
              </svg>
            ) : (
              <svg viewBox="0 0 12 12" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="7.5 2.5 4 6 7.5 9.5" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          <div className="tower__meta-bar font-mono">
            <span className="tower__count">{drivers.length || 20} DRIVERS</span>
            <button
              type="button"
              className="tower__mode-toggle font-mono"
              onClick={() => setGapMode((m) => (m === 'gap' ? 'interval' : 'gap'))}
              title="Toggle between Gap to Leader and Interval to Car Ahead"
            >
              <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="9.5 2.5 12 5 9.5 7.5" />
                <line x1="2" y1="5" x2="12" y2="5" />
                <polyline points="4.5 11.5 2 9 4.5 6.5" />
                <line x1="12" y1="9" x2="2" y2="9" />
              </svg>
              <span>{gapMode === 'gap' ? 'MODE: GAP' : 'MODE: INT'}</span>
            </button>
          </div>

          <div className="tower__list" role="list">
            {drivers.map((drv) => {
              const isSelected = selectedDrivers.includes(drv.code);
              const isPrimary = primaryDriver === drv.code;
              const tyre = getCompoundBadge(drv.compound);
              const timingValue = gapMode === 'interval' ? drv.interval : drv.gap;

              return (
                <div
                  key={drv.code}
                  role="listitem"
                  tabIndex={0}
                  className={`tower__row ${isSelected ? 'tower__row--selected' : ''} ${
                    isPrimary ? 'tower__row--primary' : ''
                  }`}
                  onClick={() => onToggleDriver && onToggleDriver(drv.code)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onToggleDriver && onToggleDriver(drv.code);
                    } else if (e.key === 's' || e.key === 'S') {
                      e.preventDefault();
                      onSetPrimaryDriver && onSetPrimaryDriver(drv.code);
                    }
                  }}
                  title={`${drv.name} (${drv.team}) — Click to compare, press S to set primary`}
                >
                  {/* Position */}
                  <span className="row__pos font-mono">{drv.position}</span>

                  {/* Team livery color stripe */}
                  <span
                    className="row__team-stripe"
                    style={{ backgroundColor: drv.color }}
                    aria-hidden="true"
                  ></span>

                  {/* Driver Code & Number */}
                  <div className="row__driver">
                    <span className="row__code font-heading">{drv.code}</span>
                    {drv.drs ? (
                      <span className="row__drs-tag font-mono">DRS</span>
                    ) : (
                      <span className="row__num font-mono">#{drv.number}</span>
                    )}
                  </div>

                  {/* Tyre badge */}
                  <div
                    className="row__tyre"
                    style={{ borderColor: tyre.color, color: tyre.color }}
                    title={`${tyre.label} Compound`}
                  >
                    <span>{tyre.letter}</span>
                  </div>

                  {/* Interval / Gap */}
                  <div className="row__timing font-mono">
                    <span className="row__gap">{timingValue}</span>
                    <span className="row__speed">{drv.speed} km/h</span>
                  </div>

                  {/* Selection Indicator Pill */}
                  <div className="row__action">
                    <button
                      type="button"
                      className={`row__check-btn ${isSelected ? 'active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isSelected && !isPrimary) {
                          onSetPrimaryDriver && onSetPrimaryDriver(drv.code);
                        } else {
                          onToggleDriver && onToggleDriver(drv.code);
                        }
                      }}
                      style={isSelected ? { borderColor: drv.color, color: drv.color } : {}}
                      title={isPrimary ? 'Primary focus driver' : isSelected ? 'Click to make primary' : 'Add to telemetry comparison'}
                      aria-label={`Select ${drv.name} for telemetry`}
                    >
                      {isPrimary ? (
                        <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true">
                          <path d="M8 1.3l2.1 4.2 4.6.7-3.3 3.2.8 4.6L8 11.8l-4.2 2.2.8-4.6L1.3 6.2l4.6-.7L8 1.3z" />
                        </svg>
                      ) : isSelected ? (
                        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <polyline points="3 8.5 6.5 12 13 4.5" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                          <line x1="8" y1="3" x2="8" y2="13" />
                          <line x1="3" y1="8" x2="13" y2="8" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="tower__footer font-mono">
            <span>FIA LIVE TIMING</span>
            <span>MAX 4 COMPARE</span>
          </div>
        </>
      )}
    </aside>
  );
}

export default memo(TimingTower);
