import { useMemo, memo } from 'react';
import { useTelemetry } from '../hooks/useTelemetry';
import Header from '../components/Header';
import SessionSelector from '../components/SessionSelector';
import StatsCard from '../components/StatsCard';
import TelemetryChart from '../components/TelemetryChart';
import GearIndicator from '../components/GearIndicator';
import './Dashboard.css';

/** SVG icon components for stat cards — defined at module scope for stable references */
const SpeedIcon = memo(function SpeedIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a10 10 0 1 0 10 10" />
      <path d="M12 12l7-7" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
});

const ThrottleIcon = memo(function ThrottleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
});

const BrakeIcon = memo(function BrakeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
  );
});

const RpmIcon = memo(function RpmIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
});

const LapIcon = memo(function LapIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 9-9 4.5 4.5 0 0 0 0 9A4.5 4.5 0 0 1 7.5 16.5" />
    </svg>
  );
});

// Pre-create icon elements so they are referentially stable across renders
const SPEED_ICON = <SpeedIcon />;
const THROTTLE_ICON = <ThrottleIcon />;
const BRAKE_ICON = <BrakeIcon />;
const RPM_ICON = <RpmIcon />;
const LAP_ICON = <LapIcon />;

export default function Dashboard() {
  const {
    sessions,
    telemetryData,
    liveData,
    stats,
    loading,
    error,
    activeSession,
    loadSession,
    wsStatus,
    clearError,
  } = useTelemetry();

  // Prefer live data if streaming; otherwise show historical
  const chartData = useMemo(() => {
    return liveData.length > 0 ? liveData : telemetryData;
  }, [liveData, telemetryData]);

  const isLive = liveData.length > 0;

  return (
    <div className="dashboard" id="dashboard">
      <Header wsStatus={wsStatus} />

      <main className="dashboard__content">
        {/* Session selector bar */}
        <section className="dashboard__toolbar" id="dashboard-toolbar">
          <SessionSelector
            sessions={sessions}
            onSelect={loadSession}
            loading={loading}
            activeSession={activeSession}
          />
          {stats && (
            <div className="dashboard__data-badge font-mono">
              <span>{stats.dataPoints} data points</span>
            </div>
          )}
        </section>

        {/* Error state — dismissible */}
        {error && (
          <div className="dashboard__error" role="alert" id="dashboard-error">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span className="dashboard__error-text">{error}</span>
            <button
              className="dashboard__error-dismiss"
              onClick={clearError}
              aria-label="Dismiss error"
              type="button"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="dashboard__loading" id="dashboard-loading">
            <div className="dashboard__stats-grid">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="skeleton stats-card-skeleton" />
              ))}
            </div>
            <div className="dashboard__charts-grid">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="skeleton chart-skeleton" />
              ))}
            </div>
          </div>
        )}

        {/* Main dashboard content */}
        {!loading && (
          <>
            {/* Stats row */}
            <section className="dashboard__stats-grid" id="stats-grid" aria-label="Telemetry statistics">
              <StatsCard
                label="Speed"
                value={stats?.currentSpeed}
                unit="km/h"
                color="var(--chart-speed)"
                icon={SPEED_ICON}
                id="stat-speed"
              />
              <StatsCard
                label="Throttle"
                value={stats?.currentThrottle}
                unit="%"
                color="var(--chart-throttle)"
                icon={THROTTLE_ICON}
                id="stat-throttle"
              />
              <StatsCard
                label="Brake"
                value={stats?.currentBrake}
                unit="%"
                color="var(--chart-brake)"
                icon={BRAKE_ICON}
                id="stat-brake"
              />
              <StatsCard
                label="RPM"
                value={stats?.currentRpm}
                unit="rpm"
                color="var(--chart-rpm)"
                icon={RPM_ICON}
                id="stat-rpm"
              />
              <StatsCard
                label="Lap"
                value={stats?.currentLap}
                unit="#"
                color="var(--chart-gear)"
                icon={LAP_ICON}
                id="stat-lap"
              />
            </section>

            {/* Charts + Gear Indicator */}
            <section className="dashboard__charts-area" id="charts-area" aria-label="Telemetry charts">
              <div className="dashboard__charts-grid">
                <TelemetryChart
                  title="Speed"
                  dataKey="speed"
                  color="var(--chart-speed)"
                  unit="km/h"
                  data={chartData}
                  id="chart-speed"
                  isLive={isLive}
                />
                <TelemetryChart
                  title="Throttle"
                  dataKey="throttle"
                  color="var(--chart-throttle)"
                  unit="%"
                  data={chartData}
                  id="chart-throttle"
                  isLive={isLive}
                />
                <TelemetryChart
                  title="Brake"
                  dataKey="brake"
                  color="var(--chart-brake)"
                  unit="%"
                  data={chartData}
                  id="chart-brake"
                  isLive={isLive}
                />
              </div>

              <aside className="dashboard__sidebar" id="dashboard-sidebar">
                <GearIndicator gear={stats?.currentGear} />
                <StatsCard
                  label="Max Speed"
                  value={stats?.maxSpeed}
                  unit="km/h"
                  color="var(--chart-speed)"
                  icon={SPEED_ICON}
                  id="stat-max-speed"
                />
                <StatsCard
                  label="Avg Speed"
                  value={stats?.avgSpeed}
                  unit="km/h"
                  color="var(--color-brand)"
                  icon={SPEED_ICON}
                  id="stat-avg-speed"
                />
              </aside>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
