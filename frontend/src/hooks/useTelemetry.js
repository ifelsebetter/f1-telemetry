import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { fetchSessions, fetchTelemetry, fetchMetadata, getWebSocketUrl } from '../services/api';
import { useWebSocket } from './useWebSocket';

const MAX_LIVE_BUFFER = 200;

/**
 * Validate a telemetry data point has the expected numeric fields.
 * Returns a sanitised copy with safe defaults, or null if invalid.
 */
function validateTelemetryPoint(raw) {
  if (raw == null || typeof raw !== 'object') return null;

  const timestamp = Number(raw.timestamp);
  const lap = Number(raw.lap);
  const speed = Number(raw.speed);
  const throttle = Number(raw.throttle);
  const brake = Number(raw.brake);
  const gear = Number(raw.gear);
  const rpm = Number(raw.rpm);

  if ([timestamp, lap, speed, throttle, brake, gear, rpm].some(Number.isNaN)) {
    return null;
  }

  return {
    timestamp,
    lap: Math.max(0, Math.floor(lap)),
    speed: Math.max(0, speed),
    throttle: Math.max(0, Math.min(100, throttle)),
    brake: Math.max(0, Math.min(100, brake)),
    gear: Math.max(0, Math.min(8, Math.floor(gear))),
    rpm: Math.max(0, rpm),
  };
}

/**
 * Validate an array of telemetry points from the REST API.
 */
function validateTelemetryBatch(data) {
  if (!Array.isArray(data)) return [];
  const result = [];
  for (const item of data) {
    const validated = validateTelemetryPoint(item);
    if (validated) result.push(validated);
  }
  return result;
}

/**
 * Safe max that handles large arrays without stack overflow.
 */
function safeMax(arr) {
  if (arr.length === 0) return 0;
  let max = arr[0];
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] > max) max = arr[i];
  }
  return max;
}

/**
 * Safe sum for averaging.
 */
function safeSum(arr) {
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
  }
  return sum;
}

/**
 * Central data hook that merges REST historical data with
 * WebSocket real-time streaming.
 *
 * @returns {object} Telemetry state and actions.
 */
export function useTelemetry() {
  const [sessions, setSessions] = useState([]);
  const [metadata, setMetadata] = useState([]);
  const [telemetryData, setTelemetryData] = useState([]);
  const [liveData, setLiveData] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeSession, setActiveSession] = useState(null);

  const liveBufferRef = useRef([]);
  const activeRequestRef = useRef(null);

  // Stabilise WebSocket URL across renders
  const wsUrl = useMemo(() => getWebSocketUrl(), []);
  const { status: wsStatus, lastMessage, sendMessage } = useWebSocket(wsUrl);

  // Load sessions and metadata on mount
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const [sessionsData, metadataData] = await Promise.all([
          fetchSessions(),
          fetchMetadata(),
        ]);
        if (cancelled) return;

        // Validate sessions shape and sanitize names
        const validSessions = Array.isArray(sessionsData)
          ? sessionsData
              .filter(
                (s) =>
                  s != null &&
                  typeof s === 'object' &&
                  typeof s.year === 'number' &&
                  typeof s.round === 'number' &&
                  typeof s.session_type === 'string'
              )
              .map((s) => ({
                ...s,
                event_name: typeof s.event_name === 'string'
                  ? s.event_name.slice(0, 100).replace(/[^\w\s\-—]/g, '')
                  : undefined
              }))
          : [];

        const validMetadata = Array.isArray(metadataData) ? metadataData : [];

        setSessions(validSessions);
        setMetadata(validMetadata);
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Failed to load initial data');
        }
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  // Process incoming WebSocket messages
  useEffect(() => {
    if (!lastMessage) return;
    if (lastMessage.type !== 'telemetry_update' || !lastMessage.payload) return;

    const point = validateTelemetryPoint(lastMessage.payload);
    if (!point) return;

    // Mutate ref buffer efficiently, then snapshot for state
    const buffer = liveBufferRef.current;
    if (buffer.length >= MAX_LIVE_BUFFER) {
      buffer.shift();
    }
    buffer.push(point);

    setLiveData(buffer.slice());
    setStats(computeStats(point, buffer));
  }, [lastMessage]);

  // Load a specific session's telemetry data
  const loadSession = useCallback(async (year, raceOrRound, sessionType, driver) => {
    const yearNum = Number(year);
    if (Number.isNaN(yearNum) || yearNum < 1950 || yearNum > 2099) {
      setError('Invalid year');
      return;
    }

    if (raceOrRound == null) {
      setError('Race or Round is required');
      return;
    }

    // if raceOrRound is a number, validate it. Otherwise, validate string length.
    let parsedRound = Number(raceOrRound);
    let race = null;
    let round = null;
    if (!Number.isNaN(parsedRound)) {
      if (parsedRound < 1) {
        setError('Round must be greater than or equal to 1');
        return;
      }
      round = parsedRound;
    } else {
      if (typeof raceOrRound !== 'string' || raceOrRound.trim().length === 0) {
        setError('Invalid race name');
        return;
      }
      race = raceOrRound.trim();
    }

    const sType = String(sessionType || 'Q').trim().toUpperCase();
    if (!sType || !/^[A-Z0-9]+$/.test(sType)) {
      setError('Invalid session type');
      return;
    }

    const driverCode = driver ? String(driver).trim().toUpperCase() : null;
    if (driverCode && !/^[A-Z0-9]{3}$/.test(driverCode)) {
      setError('Driver must be a 3-letter code (e.g. VER)');
      return;
    }

    const requestId = `${yearNum}-${raceOrRound}-${sType}-${driverCode || 'ANY'}`;
    activeRequestRef.current = requestId;

    setLoading(true);
    setError(null);

    try {
      const response = await fetchTelemetry({
        year: yearNum,
        round,
        race,
        session_type: sType,
        driver: driverCode,
      });

      if (activeRequestRef.current !== requestId) return;

      const validData = validateTelemetryBatch(
        response != null && typeof response === 'object' ? response.data : []
      );

      setTelemetryData(validData);

      const resolvedYear = response.year || yearNum;
      const resolvedRound = response.round || round || 1;
      const resolvedSessionType = response.session_type || sType;
      const resolvedDriver = response.driver || driverCode || 'VER';
      const resolvedEventName = response.event_name || (race ? `${race} Grand Prix` : `Grand Prix Round ${resolvedRound}`);

      const resolvedActiveSession = {
        year: resolvedYear,
        round: resolvedRound,
        session_type: resolvedSessionType,
        driver: resolvedDriver,
        event_name: resolvedEventName,
      };

      setActiveSession(resolvedActiveSession);

      // If the session is not in the dropdown list, add it!
      setSessions((prevSessions) => {
        const exists = prevSessions.some(
          (s) =>
            s.year === resolvedYear &&
            s.round === resolvedRound &&
            s.session_type === resolvedSessionType &&
            s.driver === resolvedDriver
        );
        if (exists) return prevSessions;
        return [...prevSessions, resolvedActiveSession];
      });

      if (validData.length > 0) {
        setStats(computeStatsFromBatch(validData));
      } else {
        setStats(null);
      }

      // Clear live buffer when switching sessions
      liveBufferRef.current = [];
      setLiveData([]);

      // Update WebSocket filters
      sendMessage({
        year: resolvedYear,
        round: resolvedRound,
        session_type: resolvedSessionType,
        driver: resolvedDriver,
      });
    } catch (err) {
      if (activeRequestRef.current === requestId) {
        setError(err.message || 'Failed to load telemetry data');
      }
    } finally {
      if (activeRequestRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [sendMessage]);

  // Auto-load the first available session if none is active
  useEffect(() => {
    if (sessions.length > 0 && telemetryData.length === 0 && !loading && !error && !activeSession) {
      const first = sessions[0];
      loadSession(first.year, first.round, first.session_type, first.driver);
    }
  }, [sessions, telemetryData.length, loading, error, activeSession, loadSession]);

  // Allow dismissing errors
  const clearError = useCallback(() => setError(null), []);

  return {
    sessions,
    metadata,
    telemetryData,
    liveData,
    stats,
    loading,
    error,
    activeSession,
    loadSession,
    wsStatus,
    clearError,
  };
}

/** Compute running stats from a new live data point. */
function computeStats(point, buffer) {
  let maxSpeed = 0;
  let sumSpeed = 0;
  const len = buffer.length;
  for (let i = 0; i < len; i++) {
    const s = buffer[i].speed;
    if (s > maxSpeed) maxSpeed = s;
    sumSpeed += s;
  }
  return {
    currentSpeed: point.speed,
    maxSpeed,
    avgSpeed: len > 0 ? sumSpeed / len : 0,
    currentThrottle: point.throttle,
    currentBrake: point.brake,
    currentGear: point.gear,
    currentRpm: point.rpm,
    currentLap: point.lap,
    dataPoints: len,
  };
}

/** Compute aggregate stats from a batch of historical data. */
function computeStatsFromBatch(data) {
  if (!data.length) return null;

  const speeds = data.map((d) => d.speed);
  const last = data[data.length - 1];

  return {
    currentSpeed: last.speed,
    maxSpeed: safeMax(speeds),
    avgSpeed: safeSum(speeds) / data.length,
    currentThrottle: last.throttle,
    currentBrake: last.brake,
    currentGear: last.gear,
    currentRpm: last.rpm,
    currentLap: last.lap,
    dataPoints: data.length,
  };
}
