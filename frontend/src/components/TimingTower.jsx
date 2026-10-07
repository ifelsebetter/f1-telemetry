import { useState, memo } from 'react';
import './TimingTower.css';

function getCompoundBadge(compound) {
  const c = (compound || 'SOFT').toUpperCase();
  if (c.startsWith('S')) return { letter: 'S', color: '#ef4444', label: 'Soft' };
  if (c.startsWith('M')) return { letter: 'M', color: '#eab308', label: 'Medium' };
  if (c.startsWith('H')) return { letter: 'H', color: '#f8fafc', label: 'Hard' };
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
  currentTime = 0,
}) {
  const [collapsed, setCollapsed] = useState(false);

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
          <span className="tower__badge font-mono">{activeSession?.session_type || 'Q3'}</span>
          <button
            type="button"
            className="tower__collapse-btn"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand timing tower' : 'Collapse timing tower'}
            title={collapsed ? 'Expand timing tower' : 'Collapse timing tower'}
          >
            {collapsed ? '▶' : '◀'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          <div className="tower__meta-bar font-mono">
            <span className="tower__count">20 DRIVERS</span>
            <span className="tower__hint">TAP TO COMPARE (MAX 4)</span>
          </div>

          <div className="tower__list" role="list">
            {drivers.map((drv) => {
              const isSelected = selectedDrivers.includes(drv.code);
              const isPrimary = primaryDriver === drv.code;
              const tyre = getCompoundBadge(drv.compound);

              return (
                <div
                  key={drv.code}
                  role="listitem"
                  className={`tower__row ${isSelected ? 'tower__row--selected' : ''} ${
                    isPrimary ? 'tower__row--primary' : ''
                  }`}
                  onClick={() => onToggleDriver && onToggleDriver(drv.code)}
                  title={drv.name}
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
                  <div className="row__driver" title={drv.name}>
                    <span className="row__code font-heading">{drv.code}</span>
                    <span className="row__num font-mono">#{drv.number}</span>
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
                    <span className="row__gap">{drv.gap}</span>
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
                      title={drv.name}
                      aria-label={`Select ${drv.name} for telemetry`}
                    >
                      {isPrimary ? '★' : isSelected ? '✓' : '+'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="tower__footer font-mono">
            <span>● FIA OFFICIAL TIMING</span>
            <span>60 HZ FEED</span>
          </div>
        </>
      )}
    </aside>
  );
}

export default memo(TimingTower);
