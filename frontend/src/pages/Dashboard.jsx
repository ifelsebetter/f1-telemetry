import { useMemo } from 'react';
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
    circuits,
    activeSession,
    activeCircuit,
    selectedDrivers,
    primaryDriver,
    allDrivers,
    multiLiveData,
    multiHistory,
    currentPoint,
    stats,
    isPlaying,
    playbackSpeed,
    currentTime,
    totalTime,
    currentLap,
    totalLaps,
    lapDuration,
    raceEta,
    loading,
    error,
    wsStatus,
    play,
    pause,
    seek,
    setSpeed,
    switchRace,
    toggleDriver,
    setPrimaryDriver,
    clearError,
  } = useTelemetry();

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
        {/* Broadcast Playback Control Bar with Timeline Scrubber */}
        <section className="playback-toolbar" id="playback-toolbar">
          <div className="toolbar-left">
            <button
              type="button"
              id="playback-toggle-btn"
              className={`playback-btn ${isPlaying ? 'btn-pause' : 'btn-play'}`}
              onClick={isPlaying ? pause : play}
              aria-label={isPlaying ? 'Pause replay stream' : 'Resume replay stream'}
            >
              {isPlaying ? '⏸ PAUSE REPLAY' : '▶ RESUME 1:1 REALTIME'}
            </button>

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
                <span className="telemetry-lap font-bold" style={{ color: '#ec4899' }}>
                  LAP {currentLap || 1}/{totalLaps || 44} ({formatTime((currentTime || 0) % (lapDuration || 106.17))}/{formatTime(lapDuration || 106.17)})
                </span>
                <span className="telemetry-eta" style={{ color: '#f59e0b', fontWeight: 700 }}>
                  ETA: {currentPoint?.eta_seconds != null ? `${currentPoint.eta_seconds.toFixed(1)}s` : `${Math.max(0, (lapDuration || 106.17) - ((currentTime || 0) % (lapDuration || 106.17))).toFixed(1)}s`}
                </span>
                <span className="telemetry-dist" style={{ color: '#38bdf8' }}>
                  DIST: {currentPoint?.distance ? `${(currentPoint.distance / 1000).toFixed(2)}km` : '0.00km'}
                </span>
              </div>
            </div>
          </div>

          <div className="toolbar-right">
            {/* Active driver comparison badges */}
            <div className="driver-badges-strip font-mono">
              <span className="strip-title">COMPARING:</span>
              {selectedDrivers.map((d) => {
                const prof = getDriverProfile(d);
                const isPrimary = d === primaryDriver;
                return (
                  <button
                    key={d}
                    type="button"
                    className={`driver-chip ${isPrimary ? 'driver-chip--primary' : ''}`}
                    style={{ borderColor: prof.color, color: prof.color }}
                    onClick={() => setPrimaryDriver(d)}
                    title={prof.name}
                  >
                    {isPrimary ? '★ ' : ''}
                    {d} #{prof.number}
                  </button>
                );
              })}
            </div>

            <div className="stream-badge font-mono">
              <span className="stream-dot"></span>
              <span>60 FPS REAL-TIME</span>
            </div>
          </div>
        </section>

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
              currentTime={currentTime}
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
                  ghostDelta={currentPoint?.delta_to_ghost ?? -0.142}
                  sector={currentPoint?.sector ?? 1}
                  drs={Boolean(currentPoint?.drs)}
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
