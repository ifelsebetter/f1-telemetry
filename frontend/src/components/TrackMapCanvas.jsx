import { useEffect, useRef, useState, useMemo, useCallback, memo } from 'react';
import { useTheme } from '../hooks/useTheme';
import { useReducedMotion } from '../hooks/useReducedMotion';
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
  inspectedPoint = null,
}) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 640, height: 520, dpr: 1 });
  const { theme } = useTheme();
  const reducedMotion = useReducedMotion();
  const isLight = theme === 'light';

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
      if (rect.width > 50 && rect.height > 50) {
        setDimensions({
          width: Math.floor(rect.width),
          height: Math.floor(rect.height),
          dpr,
        });
      }
    };

    updateSize();
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(updateSize);
      ro.observe(el);
    }
    window.addEventListener('resize', updateSize);

    let dprMedia;
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      dprMedia = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      if (typeof dprMedia.addEventListener === 'function') {
        dprMedia.addEventListener('change', updateSize);
      }
    }

    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', updateSize);
      if (dprMedia && typeof dprMedia.removeEventListener === 'function') {
        dprMedia.removeEventListener('change', updateSize);
      }
    };
  }, []);

  const circuit = activeCircuit || {
    name: 'Bahrain International Circuit',
    waypoints: [],
    turns: [],
  };

  const bgCanvasRef = useRef(null);
  const targetPositionsRef = useRef(multiPoints || {});
  const currentPositionsRef = useRef({});
  const inspectedRef = useRef(inspectedPoint);

  useEffect(() => {
    targetPositionsRef.current = multiPoints || {};
  }, [multiPoints]);

  useEffect(() => {
    inspectedRef.current = inspectedPoint;
  }, [inspectedPoint]);

  useEffect(() => {
    currentPositionsRef.current = {};
    targetPositionsRef.current = {};
  }, [circuit.name, circuit.id]);

  // Coordinate transforms in CSS pixels
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
    const padding = 42;
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

  // 1. Pre-render static track background to HiDPI offscreen canvas
  useEffect(() => {
    const { width, height, dpr } = dimensions;
    if (width <= 0 || height <= 0) return;

    const bgCanvas = document.createElement('canvas');
    bgCanvas.width = Math.round(width * dpr);
    bgCanvas.height = Math.round(height * dpr);
    const ctx = bgCanvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = isLight ? '#ffffff' : '#080d1a';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = isLight ? 'rgba(15, 23, 42, 0.045)' : 'rgba(255, 255, 255, 0.03)';
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
      ctx.beginPath();
      waypoints.forEach((pt, i) => {
        const cx = toCanvasX(pt.x);
        const cy = toCanvasY(pt.y);
        if (i === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      });
      ctx.closePath();
      ctx.strokeStyle = isLight ? '#cbd5e1' : '#1e293b';
      ctx.lineWidth = 16;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();

      const n = waypoints.length;
      const sectorColorMap = {
        1: isLight ? '#0891b2' : '#06b6d4',
        2: isLight ? '#d97706' : '#f59e0b',
        3: isLight ? '#9333ea' : '#a855f7',
      };

      for (let i = 0; i < n; i++) {
        const pt = waypoints[i];
        const nextPt = waypoints[(i + 1) % n];
        ctx.beginPath();
        ctx.moveTo(toCanvasX(pt.x), toCanvasY(pt.y));
        ctx.lineTo(toCanvasX(nextPt.x), toCanvasY(nextPt.y));
        ctx.strokeStyle = sectorColorMap[pt.sector] || (isLight ? '#0891b2' : '#06b6d4');
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
      }

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

      if (circuit.turns) {
        circuit.turns.forEach((t) => {
          const tx = toCanvasX(t.x);
          const ty = toCanvasY(t.y);
          ctx.fillStyle = isLight ? '#334155' : '#94a3b8';
          ctx.font = 'bold 10px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(t.name || `T${t.turn}`, tx, ty - 12);

          ctx.beginPath();
          ctx.arc(tx, ty, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = isLight ? '#64748b' : '#475569';
          ctx.fill();
        });
      }

      const sPt = waypoints[0];
      const sx = toCanvasX(sPt.x);
      const sy = toCanvasY(sPt.y);
      ctx.save();
      ctx.fillStyle = isLight ? '#0f172a' : '#ffffff';
      ctx.fillRect(sx - 2, sy - 8, 4, 16);
      ctx.restore();
    }

    bgCanvasRef.current = bgCanvas;
  }, [circuit, dimensions, isLight, toCanvasX, toCanvasY]);

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width, height, dpr } = dimensions;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const bgCanvas = bgCanvasRef.current;
    if (bgCanvas) {
      ctx.drawImage(bgCanvas, 0, 0);
    } else {
      ctx.fillStyle = isLight ? '#ffffff' : '#080d1a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.scale(dpr, dpr);

    const targets = targetPositionsRef.current || {};
    const currentPos = currentPositionsRef.current;
    const lerpFactor = reducedMotion ? 1.0 : 0.22;

    Object.entries(targets).forEach(([code, tPt]) => {
      if (!tPt || typeof tPt.x !== 'number' || typeof tPt.y !== 'number') return;

      if (!currentPos[code] || reducedMotion) {
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

      if (distSq > 400000) {
        curr.x = tPt.x;
        curr.y = tPt.y;
        curr.speed = tPt.speed;
        curr.live_speed_ms = tPt.live_speed_ms;
      } else {
        curr.x += dx * lerpFactor;
        curr.y += dy * lerpFactor;
        curr.speed += ((tPt.speed || 0) - curr.speed) * lerpFactor;
        curr.live_speed_ms = tPt.live_speed_ms || curr.speed / 3.6;
      }
    });

    try {
      // Pass 1: Non-selected cars
      Object.entries(currentPos).forEach(([code, curr]) => {
        if (selectedDrivers.includes(code)) return;
        const cx = toCanvasX(curr.x);
        const cy = toCanvasY(curr.y);
        if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;
        if (cx < -60 || cx > width + 60 || cy < -60 || cy > height + 60) return;

        const prof = getDriverProfile(code);
        ctx.beginPath();
        ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = prof.color;
        ctx.fill();
        ctx.strokeStyle = isLight ? 'rgba(15, 23, 42, 0.5)' : 'rgba(0, 0, 0, 0.6)';
        ctx.lineWidth = 1;
        ctx.stroke();
      });

      // Pass 2: Selected comparison cars
      const placedBadges = [];
      const candidateOffsets = [
        { dx: 10, dy: -20 },
        { dx: 10, dy: 6 },
        { dx: -112, dy: -20 },
        { dx: -112, dy: 6 },
        { dx: 10, dy: -40 },
        { dx: -112, dy: -40 },
      ];

      selectedDrivers.forEach((code) => {
        const curr = currentPos[code];
        if (!curr) return;
        const cx = toCanvasX(curr.x);
        const cy = toCanvasY(curr.y);
        if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;
        if (cx < -60 || cx > width + 60 || cy < -60 || cy > height + 60) return;

        const prof = getDriverProfile(code);
        const isPrimary = code === primaryDriver;

        // Disable decorative radial glow when prefers-reduced-motion is active
        if (!reducedMotion) {
          const glowRadius = isPrimary ? 20 : 14;
          const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, glowRadius);
          glow.addColorStop(0, prof.color);
          glow.addColorStop(0.6, `${prof.color}44`);
          glow.addColorStop(1, 'transparent');

          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(cx, cy, isPrimary ? 6.5 : 5, 0, Math.PI * 2);
        ctx.fillStyle = prof.color;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = isPrimary ? 2.5 : 1.5;
        ctx.stroke();

        const speedKmh = Math.round(curr.speed);
        const speedMs = (curr.live_speed_ms || speedKmh / 3.6).toFixed(0);
        const label = `${code} #${prof.number} ${speedKmh}k (${speedMs}m/s)`;
        const badgeW = 104;
        const badgeH = 17;

        let bx = cx + 10;
        let by = cy - 20;

        for (const off of candidateOffsets) {
          const testX = Math.max(6, Math.min(width - badgeW - 6, cx + off.dx));
          const testY = Math.max(6, Math.min(height - badgeH - 6, cy + off.dy));
          const collides = placedBadges.some(
            (b) =>
              testX < b.x + b.w + 4 &&
              testX + badgeW + 4 > b.x &&
              testY < b.y + b.h + 4 &&
              testY + badgeH + 4 > b.y
          );
          if (!collides) {
            bx = testX;
            by = testY;
            break;
          }
        }
        placedBadges.push({ x: bx, y: by, w: badgeW, h: badgeH });

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(bx + (bx < cx ? badgeW : 0), by + badgeH / 2);
        ctx.strokeStyle = `${prof.color}88`;
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = isLight ? 'rgba(255, 255, 255, 0.94)' : 'rgba(15, 23, 42, 0.92)';
        ctx.fillRect(bx, by, badgeW, badgeH);
        ctx.strokeStyle = prof.color;
        ctx.lineWidth = 1.2;
        ctx.strokeRect(bx, by, badgeW, badgeH);

        ctx.fillStyle = isLight ? '#0f172a' : '#f8fafc';
        ctx.font = 'bold 9.5px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(label, bx + 4, by + 11.5);
      });

      // Pass 3: Crosshair Inspection Target Marker
      const inspected = inspectedRef.current;
      if (inspected && typeof inspected.x === 'number' && typeof inspected.y === 'number') {
        const ix = toCanvasX(inspected.x);
        const iy = toCanvasY(inspected.y);
        if (Number.isFinite(ix) && Number.isFinite(iy)) {
          ctx.beginPath();
          ctx.arc(ix, iy, 11, 0, Math.PI * 2);
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 2;
          ctx.setLineDash([3, 3]);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.beginPath();
          ctx.arc(ix, iy, 4, 0, Math.PI * 2);
          ctx.fillStyle = '#f59e0b';
          ctx.fill();

          const tag = `INSPECT: ${Math.round(inspected.speed || 0)} km/h • G${inspected.gear ?? '-'}`;
          const tw = 128;
          const th = 18;
          const tx = Math.max(8, Math.min(width - tw - 8, ix - tw / 2));
          const ty = Math.max(8, iy - 28);
          ctx.fillStyle = isLight ? '#0f172a' : '#f59e0b';
          ctx.fillRect(tx, ty, tw, th);
          ctx.fillStyle = isLight ? '#ffffff' : '#0f172a';
          ctx.font = 'bold 9.5px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(tag, tx + tw / 2, ty + 12.5);
        }
      }
    } catch {
      // Prevent render frame crash
    }

    ctx.restore();
  }, [selectedDrivers, primaryDriver, isLight, dimensions, reducedMotion, toCanvasX, toCanvasY]);

  // When reducedMotion is false, run continuous 60 FPS rAF loop; when true, render on state updates without continuous loop
  useEffect(() => {
    if (reducedMotion) {
      drawFrame();
      return undefined;
    }
    let animId;
    const loop = () => {
      drawFrame();
      animId = requestAnimationFrame(loop);
    };
    animId = requestAnimationFrame(loop);
    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [drawFrame, reducedMotion]);

  // Trigger single frame draw in reduced-motion mode whenever telemetry or inspection changes
  useEffect(() => {
    if (reducedMotion) {
      drawFrame();
    }
  }, [multiPoints, inspectedPoint, reducedMotion, drawFrame]);

  const primaryPt = multiPoints[primaryDriver];
  const liveSpeed = primaryPt ? Math.round(primaryPt.speed) : 0;
  const liveSpeedMs = primaryPt ? (primaryPt.live_speed_ms || liveSpeed / 3.6).toFixed(1) : '0.0';
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
          <span className="legend-item"><span className="dot dot-s1" aria-hidden="true"></span> S1</span>
          <span className="legend-item"><span className="dot dot-s2" aria-hidden="true"></span> S2</span>
          <span className="legend-item"><span className="dot dot-s3" aria-hidden="true"></span> S3</span>
          <span className="legend-item"><span className="dot dot-drs" aria-hidden="true"></span> DRS Zone</span>
        </div>
      </div>

      <div className="track-map__body" ref={containerRef}>
        <canvas
          ref={canvasRef}
          width={Math.round(dimensions.width * dimensions.dpr)}
          height={Math.round(dimensions.height * dimensions.dpr)}
          style={{ width: `${dimensions.width}px`, height: `${dimensions.height}px` }}
          className="track-map__canvas"
          aria-label={`GPS circuit trace for ${circuit.name || 'Grand Prix Circuit'}`}
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
            {drs ? 'DEPLOYED' : 'STANDBY'}
          </span>
        </div>
      </div>
    </div>
  );
}

export default memo(TrackMapCanvas);
