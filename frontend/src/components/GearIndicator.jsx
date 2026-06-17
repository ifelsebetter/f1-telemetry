import { memo } from 'react';
import './GearIndicator.css';

const GEAR_COLORS = {
  0: 'var(--color-text-muted)',
  1: '#3B82F6',
  2: '#22C55E',
  3: '#F59E0B',
  4: '#EF4444',
  5: '#A855F7',
  6: '#EC4899',
  7: '#14B8A6',
  8: '#F97316',
};

/**
 * Large circular gear number display.
 *
 * @param {{ gear: number|null }} props
 */
function GearIndicator({ gear }) {
  const gearNum = gear ?? 0;
  const gearLabel = gearNum === 0 ? 'N' : String(gearNum);
  const gearColor = GEAR_COLORS[gearNum] || 'var(--color-text-muted)';

  return (
    <div className="gear-indicator card" id="gear-indicator">
      <span className="gear-indicator__label">Gear</span>
      <div
        className="gear-indicator__ring"
        style={{
          '--gear-color': gearColor,
          borderColor: gearColor,
        }}
      >
        <span
          className="gear-indicator__number font-mono"
          style={{ color: gearColor }}
        >
          {gearLabel}
        </span>
      </div>
      <span className="gear-indicator__caption font-mono">
        {gearNum === 0 ? 'Neutral' : `Gear ${gearNum}`}
      </span>
    </div>
  );
}

export default memo(GearIndicator);
