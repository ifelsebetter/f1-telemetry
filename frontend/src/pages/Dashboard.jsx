import { useState, useEffect } from 'react';
import { useTelemetry } from '../hooks/useTelemetry';
import Header from '../components/Header';
import TimingTower from '../components/TimingTower';
import TrackMapCanvas from '../components/TrackMapCanvas';
import TelemetryCanvas from '../components/TelemetryCanvas';
import PitWallHUD from '../components/PitWallHUD';
import StemPhysicsPanel from '../components/StemPhysicsPanel';
import { getDriverProfile } from '../services/circuitData';
import './Dashboard.css';

function formatTime(seconds) {
  if (seconds == null || isNaN(seconds)) return '00:00';
  const totalSecs = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export default function Dashboard() {
  const {
    sessions,
    activeSession,
    activeCircuit,
    selectedDrivers,
    primaryDriver,
    allDrivers,
    multiLiveData,
    multiHistory,
    currentPoint,
    isPlaying,
    playbackSpeed,
    currentTime,
    totalTime,
    currentLap,
    totalLaps,
    lapDuration,
    isSwitchingRace,
    error,
    wsStatus,
    play,
    pause,
    seek,
    seekLap,
    setSpeed,
    switchRace,
    toggleDriver,
    setPrimaryDriver,
    clearError,
  } = useTelemetry();

  const [inspectedPoint, setInspectedPoint] = useState(null);

  // Global keyboard shortcuts for race control
  useEffect(() => {
    const handleKeyDown = (e) => {
      const target = e.target;
      const tag = (target?.tagName || '').toLowerCase();
      if (
        tag === 'input' ||
        tag === 'select' ||
        tag === 'textarea' ||
        target?.isContentEditable
      ) {
        return;
      }

      if (e.key === 'Escape') {
        setInspectedPoint(null);
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        if (isPlaying) pause();
        else play();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        seek(Math.min(totalTime || 4671, (currentTime || 0) + 5));
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        seek(Math.max(0, (currentTime || 0) - 5));
      } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        seekLap(Math.min(totalLaps || 1, (currentLap || 1) + 1));
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        seekLap(Math.max(1, (currentLap || 1) - 1));
      } else if (['Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(e.code)) {
        const idx = Number(e.code.replace('Digit', '')) - 1;
        if (selectedDrivers[idx]) {
          setPrimaryDriver(selectedDrivers[idx]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isPlaying,
    play,
    pause,
    seek,
    seekLap,
    currentTime,
    totalTime,
    currentLap,
    totalLaps,
    selectedDrivers,
    setPrimaryDriver,
  ]);

  return (
    <div className="dashboard" id="dashboard">
      {/* Top Broadcast Header */}
      <Header
        wsStatus={wsStatus}
        sessions={sessions}
        activeSession={activeSession}
        activeCircuit={activeCircuit}
        onSwitchRace={switchRace}
        currentPoint={currentPoint}
      />

      <main className="dashboard__content">
        {/* Broadcast Playback Control Bar with Timeline Scrubber & Lap Stepper */}
        <section className="playback-toolbar" id="playback-toolbar">
          <div className="toolbar-left">
            <button
              type="button"
              id="playback-toggle-btn"
              className={`playback-btn ${isPlaying ? 'btn-pause' : 'btn-play'}`}
              onClick={isPlaying ? pause : play}
              aria-label={isPlaying ? 'Pause replay stream' : 'Resume replay stream'}
            >
              {isPlaying ? (
                <>
                  <svg viewBox="0 0 14 14" width="12" height="12" fill="currentColor" aria-hidden="true">
                    <rect x="2.5" y="2" width="3" height="10" rx="1" />
                    <rect x="8.5" y="2" width="3" height="10" rx="1" />
                  </svg>
                  <span>PAUSE REPLAY</span>
                </>
              ) : (
                <>
                  <svg viewBox="0 0 14 14" width="12" height="12" fill="currentColor" aria-hidden="true">
                    <polygon points="3,1.8 12,7 3,12.2" />
                  </svg>
                  <span>RESUME STREAM</span>
                </>
              )}
            </button>

            {/* Lap Stepper */}
            <div className="lap-stepper font-mono" role="group" aria-label="Lap selector">
              <button
                type="button"
                className="lap-step-btn"
                onClick={() => seekLap(Math.max(1, (currentLap || 1) - 1))}
                disabled={(currentLap || 1) <= 1}
                title="Previous Lap (Down Arrow)"
                aria-label="Previous Lap"
              >
                <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="7.5 2.5 4 6 7.5 9.5" />
                </svg>
              </button>
              <span className="lap-step-display">
                LAP {currentLap || 1}/{totalLaps || 1}
              </span>
              <button
                type="button"
                className="lap-step-btn"
                onClick={() => seekLap(Math.min(totalLaps || 1, (currentLap || 1) + 1))}
                disabled={(currentLap || 1) >= (totalLaps || 1)}
                title="Next Lap (Up Arrow)"
                aria-label="Next Lap"
              >
                <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="4.5 2.5 8 6 4.5 9.5" />
                </svg>
              </button>
            </div>

            <div className="speed-selector">
              <span className="speed-label font-mono">SPEED:</span>
              {[0.5, 1.0, 2.0, 5.0, 10.0, 30.0].map((spd) => (
                <button
                  type="button"
                  key={spd}
                  className={`speed-btn font-mono ${playbackSpeed === spd ? 'speed-active' : ''}`}
                  onClick={() => setSpeed(spd)}
                  title={spd === 1.0 ? 'Real-time 1:1 playback' : `${spd}x speed`}
                >
                  {spd === 1.0 ? '1x (1:1)' : `${spd}x`}
                </button>
              ))}
            </div>
          </div>

          {/* Scrubber Timeline */}
          <div className="toolbar-center">
            <div className="scrubber-container">
              <input
                type="range"
                min="0"
                max={totalTime || 4671.48}
                step="0.1"
                value={currentTime || 0}
                onChange={(e) => seek(parseFloat(e.target.value))}
                className="scrubber-slider"
                id="telemetry-scrubber"
                aria-label="Seek telemetry replay time"
              />
              <div className="scrubber-info font-mono">
                <span className="telemetry-clock">
                  RACE: {formatTime(currentTime)} / {formatTime(totalTime || 4671.48)}
                </span>
                <span className="telemetry-lap">
                  LAP TIME: {formatTime((currentTime || 0) % (lapDuration || 106.17))}/{formatTime(lapDuration || 106.17)}
                </span>
                <span className="telemetry-eta">
                  ETA: {currentPoint?.eta_seconds != null ? `${currentPoint.eta_seconds.toFixed(1)}s` : `${Math.max(0, (lapDuration || 106.17) - ((currentTime || 0) % (lapDuration || 106.17))).toFixed(1)}s`}
                </span>
                <span className="telemetry-dist">
                  DIST: {currentPoint?.distance ? `${(currentPoint.distance / 1000).toFixed(2)}km` : '0.00km'}
                </span>
              </div>
            </div>
          </div>

          <div className="toolbar-right">
            {/* Active driver comparison badges */}
            <div className="driver-badges-strip font-mono">
              <span className="strip-title">COMPARING:</span>
              {selectedDrivers.map((d, idx) => {
                const prof = getDriverProfile(d);
                const isPrimary = d === primaryDriver;
                return (
                  <button
                    key={d}
                    type="button"
                    className={`driver-chip ${isPrimary ? 'driver-chip--primary' : ''}`}
                    style={{ borderColor: prof.color, color: prof.color }}
                    onClick={() => setPrimaryDriver(d)}
                    title={`${prof.name} (Shortcut: Key ${idx + 1})`}
                  >
                    {isPrimary && (
                      <svg viewBox="0 0 16 16" width="10" height="10" fill="currentColor" aria-hidden="true">
                        <path d="M8 1.3l2.1 4.2 4.6.7-3.3 3.2.8 4.6L8 11.8l-4.2 2.2.8-4.6L1.3 6.2l4.6-.7L8 1.3z" />
                      </svg>
                    )}
                    <span>{d} #{prof.number}</span>
                  </button>
                );
              })}
            </div>

            <div className="shortcut-hint font-mono" title="Keyboard Shortcuts: Space (Play/Pause), Left/Right (±5s), Up/Down (Next/Prev Lap), 1-4 (Select Primary Driver)">
              KEYS: SPACE • ←/→ • ↑/↓ • 1-4
            </div>
          </div>
        </section>

        {isSwitchingRace && (
          <div className="dashboard__loading-banner font-mono" role="status">
            <span className="loading-spinner" aria-hidden="true"></span>
            <span>SYNCHRONIZING FASTF1 SESSION TELEMETRY & 20-CAR GRID...</span>
          </div>
        )}

        {error && (
          <div className="dashboard__error card" role="alert">
            <p>{error}</p>
            <button type="button" onClick={clearError}>Dismiss</button>
          </div>
        )}

        {/* Apex Pitwall Workspace: Left Leaderboard + Right Telemetry Grid */}
        <div className="dashboard__workspace">
          {/* Left Column: Authentic F1 Broadcast Timing Tower */}
          <div className="workspace__tower-col">
            <TimingTower
              drivers={allDrivers}
              selectedDrivers={selectedDrivers}
              primaryDriver={primaryDriver}
              onToggleDriver={toggleDriver}
              onSetPrimaryDriver={setPrimaryDriver}
              activeSession={activeSession}
            />
          </div>

          {/* Right Column: Broadcast Canvas & HUD Suite */}
          <div className="workspace__main-col">
            {/* Top Row: Track Map & Pit-Wall HUD */}
            <div className="dashboard__grid-top">
              <div className="grid-cell-map">
                <TrackMapCanvas
                  activeCircuit={activeCircuit}
                  multiPoints={multiLiveData}
                  selectedDrivers={selectedDrivers}
                  primaryDriver={primaryDriver}
                  ghostDelta={currentPoint?.delta_to_ghost ?? 0}
                  sector={currentPoint?.sector ?? 1}
                  drs={Boolean(currentPoint?.drs)}
                  inspectedPoint={inspectedPoint}
                />
              </div>

              <div className="grid-cell-hud">
                <PitWallHUD
                  currentPoint={currentPoint}
                  primaryDriver={primaryDriver}
                  selectedDrivers={selectedDrivers}
                  multiPoints={multiLiveData}
                />
              </div>
            </div>

            {/* Middle Row: 60 FPS Multi-Driver Telemetry Oscilloscope */}
            <div className="dashboard__row-telemetry">
              <TelemetryCanvas
                multiHistory={multiHistory}
                selectedDrivers={selectedDrivers}
                primaryDriver={primaryDriver}
                onInspectPoint={setInspectedPoint}
              />
            </div>

            {/* Bottom Row: Science Fair STEM Physics Panel */}
            <div className="dashboard__row-stem">
              <StemPhysicsPanel currentPoint={currentPoint} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
