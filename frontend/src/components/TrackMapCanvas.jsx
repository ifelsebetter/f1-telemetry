import { useEffect, useRef, useState, useMemo, memo } from 'react';
import { useTheme } from '../hooks/useTheme';
import { getDriverProfile } from '../services/circuitData';
import './TrackMapCanvas.css';

function TrackMapCanvas({
  activeCircuit,
  multiPoints = {},
  selectedDrivers = ['VER'],
  primaryDriver = 'VER',
  ghostDelta = 0,
  sector = 1,
  drs = false,
}) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 640, height: 520 });
  const { theme } = useTheme();
  const isLight = theme === 'light';

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 50 && rect.height > 50) {
        setDimensions({
          width: Math.floor(rect.width),
          height: Math.floor(rect.height),
        });
      }
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const circuit = activeCircuit || {
    name: 'Bahrain International Circuit',
    waypoints: [],
    turns: [],
  };

  const bgCanvasRef = useRef(null);
  const targetPositionsRef = useRef(multiPoints || {});
  const currentPositionsRef = useRef({});

  // Keep targetPositionsRef updated whenever new WebSocket data arrives
  useEffect(() => {
    targetPositionsRef.current = multiPoints || {};
  }, [multiPoints]);

  // Reset positions on circuit change to avoid jumping
  useEffect(() => {
    currentPositionsRef.current = {};
  }, [circuit.name, circuit.id]);

  // Coordinate transforms
  const { toCanvasX, toCanvasY } = useMemo(() => {
    const waypoints = circuit.waypoints || [];
    if (waypoints.length < 3) {
      return { toCanvasX: () => 0, toCanvasY: () => 0 };
    }
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    waypoints.forEach((p) => {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    });

    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);
    const padding = 50;
    const { width, height } = dimensions;

    const scaleX = (width - padding * 2) / spanX;
    const scaleY = (height - padding * 2) / spanY;
    const scale = Math.min(scaleX, scaleY);

    return {
      toCanvasX: (rawX) =>
        padding + (rawX - minX) * scale + (width - padding * 2 - spanX * scale) / 2,
      toCanvasY: (rawY) =>
        height - (padding + (rawY - minY) * scale + (height - padding * 2 - spanY * scale) / 2),
    };
  }, [circuit, dimensions]);

  // 1. Pre-render static track background to offscreen canvas
  useEffect(() => {
    const { width, height } = dimensions;
    if (width <= 0 || height <= 0) return;

    const bgCanvas = document.createElement('canvas');
    bgCanvas.width = width;
    bgCanvas.height = height;
    const ctx = bgCanvas.getContext('2d');

    // Clear background
    ctx.fillStyle = isLight ? '#ffffff' : '#080d1a';
    ctx.fillRect(0, 0, width, height);

    // Subtle radar/grid pattern
    ctx.strokeStyle = isLight ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    const gridSize = 40;
    for (let x = 0; x < width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    const waypoints = circuit.waypoints || [];
    if (waypoints.length >= 3) {
      // 1. Draw track asphalt outline (thick base track)
      ctx.beginPath();
      waypoints.forEach((pt, i) => {
        const cx = toCanvasX(pt.x);
        const cy = toCanvasY(pt.y);
        if (i === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      });
      ctx.closePath();
      ctx.strokeStyle = isLight ? '#e2e8f0' : '#1e293b';
      ctx.lineWidth = 16;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();

      // 2. Draw Sectors (S1 Cyan, S2 Amber, S3 Purple)
      const n = waypoints.length;
      const sectorColorMap = {
        1: isLight ? '#0284c7' : '#06b6d4',
        2: isLight ? '#d97706' : '#f59e0b',
        3: isLight ? '#7c3aed' : '#a855f7',
      };

      for (let i = 0; i < n; i++) {
        const pt = waypoints[i];
        const nextPt = waypoints[(i + 1) % n];
        ctx.beginPath();
        ctx.moveTo(toCanvasX(pt.x), toCanvasY(pt.y));
        ctx.lineTo(toCanvasX(nextPt.x), toCanvasY(nextPt.y));
        ctx.strokeStyle = sectorColorMap[pt.sector] || (isLight ? '#0284c7' : '#06b6d4');
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
      }

      // 3. Draw DRS Zones
      waypoints.forEach((pt, i) => {
        if (pt.drs && i < n - 1 && waypoints[i + 1].drs) {
          ctx.beginPath();
          ctx.moveTo(toCanvasX(pt.x), toCanvasY(pt.y));
          ctx.lineTo(toCanvasX(waypoints[i + 1].x), toCanvasY(waypoints[i + 1].y));
          ctx.strokeStyle = '#22c55e';
          ctx.lineWidth = 6;
          ctx.stroke();
        }
      });

      // 4. Draw Turn Labels
      if (circuit.turns) {
        circuit.turns.forEach((t) => {
          const tx = toCanvasX(t.x);
          const ty = toCanvasY(t.y);
          ctx.fillStyle = isLight ? '#475569' : '#94a3b8';
          ctx.font = 'bold 9px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(t.name || `T${t.turn}`, tx, ty - 12);

          ctx.beginPath();
          ctx.arc(tx, ty, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = isLight ? '#94a3b8' : '#475569';
          ctx.fill();
        });
      }

      // 5. Draw Start / Finish line
      const sPt = waypoints[0];
      const sx = toCanvasX(sPt.x);
      const sy = toCanvasY(sPt.y);
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(sx - 2, sy - 8, 4, 16);
      ctx.restore();
    }

    bgCanvasRef.current = bgCanvas;
  }, [circuit, dimensions, isLight, toCanvasX, toCanvasY]);

  // 2. Continuous 60/120 FPS requestAnimationFrame loop with smooth position lerp
  useEffect(() => {
    let animId;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const render = () => {
      const bgCanvas = bgCanvasRef.current;
      if (bgCanvas) {
        ctx.drawImage(bgCanvas, 0, 0);
      } else {
        ctx.fillStyle = isLight ? '#ffffff' : '#080d1a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      const targets = targetPositionsRef.current || {};
      const currentPos = currentPositionsRef.current;
      const lerpFactor = 0.22; // High-refresh smooth interpolation

      // Interpolate each driver's coordinates towards target
      Object.entries(targets).forEach(([code, tPt]) => {
        if (!tPt || typeof tPt.x !== 'number' || typeof tPt.y !== 'number') return;

        if (!currentPos[code]) {
          currentPos[code] = {
            x: tPt.x,
            y: tPt.y,
            speed: tPt.speed || 0,
            live_speed_ms: tPt.live_speed_ms || (tPt.speed ? tPt.speed / 3.6 : 0),
          };
          return;
        }

        const curr = currentPos[code];
        const dx = tPt.x - curr.x;
        const dy = tPt.y - curr.y;
        const distSq = dx * dx + dy * dy;

        // Large jump (timeline seek or lap wrap): snap immediately
        if (distSq > 400000) {
          curr.x = tPt.x;
          curr.y = tPt.y;
          curr.speed = tPt.speed;
          curr.live_speed_ms = tPt.live_speed_ms;
        } else {
          curr.x += dx * lerpFactor;
          curr.y += dy * lerpFactor;
          curr.speed += ((tPt.speed || 0) - curr.speed) * lerpFactor;
          curr.live_speed_ms = tPt.live_speed_ms || (curr.speed / 3.6);
        }
      });

      try {
        // Pass 1: Non-selected cars as smaller dots
        Object.entries(currentPos).forEach(([code, curr]) => {
          if (selectedDrivers.includes(code)) return;
          const cx = toCanvasX(curr.x);
          const cy = toCanvasY(curr.y);
          if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;

          const prof = getDriverProfile(code);
          ctx.beginPath();
          ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
          ctx.fillStyle = prof.color;
          ctx.fill();
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
          ctx.lineWidth = 1;
          ctx.stroke();
        });

        // Pass 2: Selected comparison cars with glowing halos and speed badges
        selectedDrivers.forEach((code) => {
          const curr = currentPos[code];
          if (!curr) return;
          const cx = toCanvasX(curr.x);
          const cy = toCanvasY(curr.y);
          if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;

          const prof = getDriverProfile(code);
          const isPrimary = code === primaryDriver;

          // Outer glow
          const glowRadius = isPrimary ? 20 : 14;
          const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, glowRadius);
          glow.addColorStop(0, prof.color);
          glow.addColorStop(0.6, `${prof.color}44`);
          glow.addColorStop(1, 'transparent');

          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2);
          ctx.fill();

          // Core car dot
          ctx.beginPath();
          ctx.arc(cx, cy, isPrimary ? 6.5 : 5, 0, Math.PI * 2);
          ctx.fillStyle = prof.color;
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = isPrimary ? 2.5 : 1.5;
          ctx.stroke();

          // Driver Speed Badge
          const speedKmh = Math.round(curr.speed);
          const speedMs = (curr.live_speed_ms || (speedKmh / 3.6)).toFixed(0);
          const label = `${code} #${prof.number} ${speedKmh}k (${speedMs}m/s)`;
          const badgeW = 96;
          const badgeH = 16;
          const bx = cx + 8;
          const by = cy - 18;

          ctx.save();
          ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
          ctx.fillRect(bx, by, badgeW, badgeH);
          ctx.strokeStyle = prof.color;
          ctx.lineWidth = 1;
          ctx.strokeRect(bx, by, badgeW, badgeH);

          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 9px "JetBrains Mono", monospace';
          ctx.textAlign = 'left';
          ctx.fillText(label, bx + 4, by + 11);
          ctx.restore();
        });
      } catch (err) {
        // Prevent render frame crash
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [selectedDrivers, primaryDriver, isLight, toCanvasX, toCanvasY]);

  const primaryPt = multiPoints[primaryDriver];
  const liveSpeed = primaryPt ? Math.round(primaryPt.speed) : 0;
  const liveSpeedMs = primaryPt ? (primaryPt.live_speed_ms || (liveSpeed / 3.6)).toFixed(1) : '0.0';
  const liveDist = primaryPt?.distance ? (primaryPt.distance / 1000).toFixed(2) : '0.00';
  const liveEta = primaryPt?.eta_seconds != null ? `${primaryPt.eta_seconds.toFixed(1)}s` : '--';

  return (
    <div className="track-map-card card" id="track-map-card">
      <div className="track-map__header">
        <div className="track-map__title-group">
          <span className="track-map__badge">GPS TRACK TRACE</span>
          <h3 className="track-map__title">{circuit.name || 'Grand Prix Circuit'}</h3>
        </div>
        <div className="track-map__legend">
          <span className="legend-item"><span className="dot dot-s1"></span> S1</span>
          <span className="legend-item"><span className="dot dot-s2"></span> S2</span>
          <span className="legend-item"><span className="dot dot-s3"></span> S3</span>
          <span className="legend-item"><span className="dot dot-drs"></span> DRS Zone</span>
        </div>
      </div>

      <div className="track-map__body" ref={containerRef}>
        <canvas
          ref={canvasRef}
          width={dimensions.width}
          height={dimensions.height}
          className="track-map__canvas"
        />
      </div>

      <div className="track-map__footer">
        <div className="overlay-stat">
          <span className="stat-label">ACTIVE SECTOR</span>
          <span className={`stat-value sec-${sector}`}>SECTOR {sector}</span>
        </div>
        <div className="overlay-stat">
          <span className="stat-label">LIVE SPEED</span>
          <span className="stat-value font-mono cyan-glow">
            {liveSpeed} KM/H <small>({liveSpeedMs} m/s)</small>
          </span>
        </div>
        <div className="overlay-stat">
          <span className="stat-label">LAP DISTANCE</span>
          <span className="stat-value font-mono">{liveDist} km</span>
        </div>
        <div className="overlay-stat">
          <span className="stat-label">REAL-TIME ETA</span>
          <span className="stat-value font-mono gold-glow">{liveEta}</span>
        </div>
        <div className="overlay-stat">
          <span className="stat-label">GHOST DELTA</span>
          <span className={`stat-value delta-${ghostDelta <= 0 ? 'faster' : 'slower'}`}>
            {ghostDelta <= 0 ? `${ghostDelta.toFixed(3)}s` : `+${ghostDelta.toFixed(3)}s`}
          </span>
        </div>
        <div className="overlay-stat">
          <span className="stat-label">DRS REAR WING</span>
          <span className={`stat-badge ${drs ? 'drs-active' : 'drs-inactive'}`}>
            {drs ? '● DEPLOYED' : 'STANDBY'}
          </span>
        </div>
      </div>
    </div>
  );
}

export default memo(TrackMapCanvas);
