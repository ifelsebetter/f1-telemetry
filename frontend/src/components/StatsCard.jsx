import { memo } from 'react';
import './StatsCard.css';

/**
 * KPI stat card component.
 *
 * @param {{ label: string, value: string|number, unit: string, color?: string, icon?: React.ReactNode, id: string }} props
 */
function StatsCard({ label, value, unit, color, icon, id }) {
  const formattedValue = typeof value === 'number'
    ? (Number.isInteger(value) ? value.toString() : value.toFixed(1))
    : (value ?? '—');

  return (
    <div
      className="stats-card card"
      style={{ '--stat-color': color || 'var(--color-accent)' }}
      id={id}
    >
      <div className="stats-card__header">
        {icon && <span className="stats-card__icon" aria-hidden="true">{icon}</span>}
        <span className="stats-card__label">{label}</span>
      </div>
      <div className="stats-card__value-row">
        <span className="stats-card__value font-mono">{formattedValue}</span>
        <span className="stats-card__unit font-mono">{unit}</span>
      </div>
      <div className="stats-card__accent-line" aria-hidden="true" />
    </div>
  );
}

export default memo(StatsCard);
