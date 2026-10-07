import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { fetchSessions, fetchTelemetry, fetchMetadata, fetchCircuits, fetchCircuit, getWebSocketUrl } from '../services/api';
import { DRIVER_PROFILES, getCircuitPreset, getDriverProfile } from '../services/circuitData';
import { useWebSocket } from './useWebSocket';

const MAX_CHART_BUFFER = 240;

function sanitizeTelemetryPoint(raw) {
  if (raw == null || typeof raw !== 'object') return null;

  const timestamp = Number(raw.timestamp);
  const lap = Number(raw.lap ?? 1);
  const speed = Number(raw.speed ?? 0);
  const throttle = Number(raw.throttle ?? 0);
  const brake = Number(raw.brake ?? 0);
  const gear = Number(raw.gear ?? 0);
  const rpm = Number(raw.rpm ?? 0);

  if ([timestamp, lap, speed, throttle, brake, gear, rpm].some(Number.isNaN)) {
    return null;
  }

  return {
    timestamp,
    lap: Math.max(1, Math.floor(lap)),
    speed: Math.max(0, speed),
    throttle: Math.max(0, Math.min(100, throttle)),
    brake: Math.max(0, Math.min(100, brake)),
    gear: Math.max(0, Math.min(8, Math.floor(gear))),
    rpm: Math.max(0, rpm),
    x: Number(raw.x ?? 0),
    y: Number(raw.y ?? 0),
    z: Number(raw.z ?? 0),
    steer: Number(raw.steer ?? 0),
    ers_soc: Math.max(0, Math.min(100, Number(raw.ers_soc ?? 100))),
    ers_harvest: Math.max(0, Number(raw.ers_harvest ?? 0)),
    tyre_temp_fl: Number(raw.tyre_temp_fl ?? 92),
    tyre_temp_fr: Number(raw.tyre_temp_fr ?? 94),
    tyre_temp_rl: Number(raw.tyre_temp_rl ?? 91),
    tyre_temp_rr: Number(raw.tyre_temp_rr ?? 93),
    tyre_wear: Math.max(0, Math.min(100, Number(raw.tyre_wear ?? 10))),
    tyre_compound: String(raw.tyre_compound || 'SOFT'),
    drs: Boolean(raw.drs),
    flag: String(raw.flag || 'GREEN'),
    safety_car: String(raw.safety_car || 'NONE'),
    delta_to_ghost: Number(raw.delta_to_ghost ?? 0),
    sector: Math.max(1, Math.min(3, Math.floor(Number(raw.sector ?? 1)))),
    mini_sector: Math.max(1, Math.floor(Number(raw.mini_sector ?? 1))),
    distance: Math.max(0, Number(raw.distance ?? 0)),
    dist_remaining: Math.max(0, Number(raw.dist_remaining ?? 0)),
    live_speed_ms: Math.max(0, Number(Number(raw.live_speed_ms ?? (speed / 3.6)).toFixed(1))),
    eta_seconds: Math.max(0, Number(Number(raw.eta_seconds ?? 0).toFixed(2))),
    lap_time: Number(raw.lap_time ?? 0),
    race_time: Number(raw.race_time ?? timestamp),
    total_laps: Math.max(1, Math.floor(Number(raw.total_laps ?? 1))),
    total_race_duration: Math.max(0, Number(raw.total_race_duration ?? 0)),
    race_eta_seconds: Math.max(0, Number(raw.race_eta_seconds ?? 0)),
  };
}

export function useTelemetry() {
  const [sessions, setSessions] = useState([]);
  const [circuits, setCircuits] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [activeCircuit, setActiveCircuit] = useState(() => getCircuitPreset('bahrain'));

  // Multi-driver selection state
  const [selectedDrivers, setSelectedDrivers] = useState(['VER', 'NOR']);
  const [primaryDriver, setPrimaryDriverState] = useState('VER');

  // Live multi-driver dictionaries
  const [multiLiveData, setMultiLiveData] = useState({});
  const [multiHistory, setMultiHistory] = useState({});
  const [currentPoint, setCurrentPoint] = useState(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [currentTime, setCurrentTime] = useState(0.0);
  const [totalTime, setTotalTime] = useState(4671.48);
  const [currentLap, setCurrentLap] = useState(1);
  const [totalLaps, setTotalLaps] = useState(44);
  const [lapDuration, setLapDuration] = useState(106.17);
  const [raceEta, setRaceEta] = useState(0);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const historyBuffersRef = useRef({});
  const wsUrl = useMemo(() => getWebSocketUrl(), []);
  const { status: wsStatus, lastMessage, sendMessage } = useWebSocket(wsUrl);

  // 1. Initial Load of sessions and circuits
  useEffect(() => {
    let cancelled = false;

    async function init() {
      setLoading(true);
      try {
        const [sessionsData, circuitsData] = await Promise.all([
          fetchSessions().catch(() => []),
          fetchCircuits().catch(() => []),
        ]);
        if (cancelled) return;

        if (Array.isArray(sessionsData) && sessionsData.length > 0) {
          setSessions(sessionsData);
          const first = sessionsData[0];
          setActiveSession(first);
          if (first.circuit_id) {
            fetchCircuit(first.circuit_id).then((c) => {
              if (c && !cancelled) setActiveCircuit(c);
            }).catch(() => {});
          }
        }
        if (Array.isArray(circuitsData)) {
          setCircuits(circuitsData);
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Initialization failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  // 2. Process incoming WebSocket multi-driver packets
  useEffect(() => {
    if (!lastMessage) return;

    if (lastMessage.type === 'playback_status' && typeof lastMessage.isPlaying === 'boolean') {
      setIsPlaying(lastMessage.isPlaying);
      return;
    }
    if (lastMessage.type === 'speed_status' && typeof lastMessage.speed === 'number') {
      setPlaybackSpeed(lastMessage.speed);
      return;
    }

    if (lastMessage.type !== 'telemetry_update') return;

    if (typeof lastMessage.total_race_duration === 'number' && lastMessage.total_race_duration > 0) {
      setTotalTime(lastMessage.total_race_duration);
    } else if (typeof lastMessage.lap_duration === 'number' && lastMessage.lap_duration > 0) {
      setTotalTime(lastMessage.lap_duration);
    }

    if (typeof lastMessage.current_lap === 'number') {
      setCurrentLap(lastMessage.current_lap);
    }
    if (typeof lastMessage.total_laps === 'number') {
      setTotalLaps(lastMessage.total_laps);
    }
    if (typeof lastMessage.lap_duration === 'number') {
      setLapDuration(lastMessage.lap_duration);
    }
    if (typeof lastMessage.race_eta_seconds === 'number') {
      setRaceEta(lastMessage.race_eta_seconds);
    }

    // Synchronize active circuit if stream circuit differs
    if (lastMessage.circuit_id && (!activeCircuit || activeCircuit.id !== lastMessage.circuit_id)) {
      fetchCircuit(lastMessage.circuit_id).then((c) => {
        if (c) setActiveCircuit(c);
      }).catch(() => {});
    }

    const rawMulti = lastMessage.multi_payload || {};
    const sanitizedMulti = {};

    // Validate all incoming driver points
    for (const [code, rawPt] of Object.entries(rawMulti)) {
      const sanitized = sanitizeTelemetryPoint(rawPt);
      if (sanitized) {
        sanitizedMulti[code] = sanitized;
      }
    }

    // Ensure fallback primary point exists
    if (!sanitizedMulti[primaryDriver] && lastMessage.payload) {
      const p = sanitizeTelemetryPoint(lastMessage.payload);
      if (p) sanitizedMulti[primaryDriver] = p;
    }

    setMultiLiveData(sanitizedMulti);

    const activePrimaryPt = sanitizedMulti[primaryDriver] || Object.values(sanitizedMulti)[0];
    if (activePrimaryPt) {
      setCurrentPoint(activePrimaryPt);
      setCurrentTime(activePrimaryPt.timestamp);
    }

    // Update historical chart buffers for selected drivers
    const currentHist = historyBuffersRef.current;
    const updatedHist = {};

    selectedDrivers.forEach((drv) => {
      const pt = sanitizedMulti[drv];
      if (pt) {
        if (!currentHist[drv]) currentHist[drv] = [];
        if (currentHist[drv].length >= MAX_CHART_BUFFER) {
          currentHist[drv].shift();
        }
        currentHist[drv].push(pt);
      }
      updatedHist[drv] = (currentHist[drv] || []).slice();
    });

    setMultiHistory(updatedHist);
  }, [lastMessage, primaryDriver, selectedDrivers]);

  // 3. Playback Controls
  const play = useCallback(() => {
    sendMessage({ type: 'play' });
    setIsPlaying(true);
  }, [sendMessage]);

  const pause = useCallback(() => {
    sendMessage({ type: 'pause' });
    setIsPlaying(false);
  }, [sendMessage]);

  const seek = useCallback((timestamp) => {
    const ts = Number(timestamp);
    sendMessage({ type: 'seek', timestamp: ts });
    setCurrentTime(ts);
    // Flush history on seek to prevent graph jitter
    historyBuffersRef.current = {};
  }, [sendMessage]);

  const setSpeed = useCallback((spd) => {
    const num = Number(spd);
    sendMessage({ type: 'set_speed', speed: num });
    setPlaybackSpeed(num);
  }, [sendMessage]);

  // 4. Switch Grand Prix Race
  const switchRace = useCallback(async (sessionItem) => {
    if (!sessionItem) return;
    setActiveSession(sessionItem);

    const circuitId = sessionItem.circuit_id || 'bahrain';
    fetchCircuit(circuitId).then((c) => {
      if (c) setActiveCircuit(c);
    }).catch(() => {});

    // Flush chart buffers on race switch
    historyBuffersRef.current = {};

    sendMessage({
      type: 'switch_race',
      year: sessionItem.year,
      round: sessionItem.round,
      session_type: sessionItem.session_type || 'Q',
      circuit_id: circuitId,
    });
  }, [sendMessage]);

  // 5. Driver selection toggles
  const toggleDriver = useCallback((driverCode) => {
    const code = driverCode.toUpperCase();
    setSelectedDrivers((prev) => {
      if (prev.includes(code)) {
        if (prev.length === 1) return prev; // Keep at least one
        const filtered = prev.filter((d) => d !== code);
        if (primaryDriver === code) {
          setPrimaryDriverState(filtered[0]);
        }
        return filtered;
      } else {
        if (prev.length >= 4) {
          // Replace second or last to keep limit 4
          return [...prev.slice(0, 3), code];
        }
        return [...prev, code];
      }
    });
  }, [primaryDriver]);

  const setPrimaryDriver = useCallback((driverCode) => {
    const code = driverCode.toUpperCase();
    setPrimaryDriverState(code);
    setSelectedDrivers((prev) => (prev.includes(code) ? prev : [code, ...prev.slice(0, 3)]));
    sendMessage({ type: 'set_driver', driver: code });
  }, [sendMessage]);

  // 6. Compute Full 20-Driver Timing Tower List
  const allDrivers = useMemo(() => {
    const driverCodes = Object.keys(DRIVER_PROFILES);
    const sorted = driverCodes.map((code, idx) => {
      const profile = getDriverProfile(code);
      const livePt = multiLiveData[code];
      const delta = livePt ? livePt.delta_to_ghost : idx * 0.18;
      const speed = livePt ? Math.round(livePt.speed) : 290;
      const liveSpeedMs = livePt ? (livePt.live_speed_ms || (speed / 3.6)).toFixed(1) : (speed / 3.6).toFixed(1);
      const distance = livePt ? livePt.distance : 0;
      const distRemaining = livePt ? livePt.dist_remaining : 0;
      const etaSeconds = livePt ? livePt.eta_seconds : Math.max(0, (totalTime || 90.0) - currentTime);
      const gear = livePt ? livePt.gear : 7;
      const sector = livePt ? livePt.sector : 1;
      const compound = livePt ? livePt.tyre_compound : (idx % 3 === 0 ? 'SOFT' : idx % 3 === 1 ? 'MEDIUM' : 'HARD');

      return {
        code,
        name: profile.name,
        team: profile.team,
        color: profile.color,
        number: profile.number,
        position: idx + 1,
        gap: idx === 0 ? 'LEADER' : `+${delta.toFixed(3)}s`,
        interval: idx === 0 ? 'INTERVAL' : `+${(0.12 + (idx * 0.05)).toFixed(3)}s`,
        speed,
        live_speed_ms: liveSpeedMs,
        distance,
        dist_remaining: distRemaining,
        eta_seconds: etaSeconds,
        gear,
        sector,
        compound,
        drs: livePt ? livePt.drs : false,
        isSelected: selectedDrivers.includes(code),
        isPrimary: primaryDriver === code,
        livePoint: livePt,
      };
    });

    // Rank by position
    return sorted;
  }, [multiLiveData, selectedDrivers, primaryDriver]);

  // Stats for the active primary car
  const stats = useMemo(() => {
    if (!currentPoint) return null;
    return {
      currentSpeed: currentPoint.speed,
      currentRpm: currentPoint.rpm,
      currentGear: currentPoint.gear,
      currentThrottle: currentPoint.throttle,
      currentBrake: currentPoint.brake,
      sector: currentPoint.sector,
      delta: currentPoint.delta_to_ghost,
      ersSoc: currentPoint.ers_soc,
      drs: currentPoint.drs,
      dataPoints: (multiHistory[primaryDriver] || []).length,
    };
  }, [currentPoint, multiHistory, primaryDriver]);

  return {
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
    clearError: () => setError(null),
  };
}
