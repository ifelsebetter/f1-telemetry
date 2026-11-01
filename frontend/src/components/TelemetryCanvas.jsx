import { useEffect, useRef, useState, useCallback, memo } from 'react';
import { useTheme } from '../hooks/useTheme';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { getDriverProfile } from '../services/circuitData';
import './TelemetryCanvas.css';

const CANVAS_HEIGHT = 380;

function TelemetryCanvas({
  multiHistory = {},
  selectedDrivers = ['VER'],
  primaryDriver = 'VER',
  onInspectPoint,
}) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const [size, setSize] = useState({ width: 1100, dpr: 1 });
  const [hoverNormX, setHoverNormX] = useState(null);
  const { theme } = useTheme();
  const reducedMotion = useReducedMotion();
  const isLight = theme === 'light';

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
      if (rect.width > 50) {
        setSize({ width: Math.floor(rect.width), dpr });
      }
    };
    updateSize();
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(updateSize);
      ro.observe(el);
    }
    window.addEventListener('resize', updateSize);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, []);

  const handlePointerMove = useCallback(
    (clientX) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const relX = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const norm = rect.width > 0 ? relX / rect.width : 0;
      setHoverNormX(norm);

      if (onInspectPoint) {
        const primaryPts = (multiHistory[primaryDriver] || []).slice(-200);
        if (primaryPts.length > 0) {
          const idx = Math.min(
            primaryPts.length - 1,
            Math.max(0, Math.round(norm * (primaryPts.length - 1)))
          );
          onInspectPoint(primaryPts[idx]);
        }
      }
    },
    [multiHistory, primaryDriver, onInspectPoint]
  );

  const handleMouseLeave = useCallback(() => {
    setHoverNormX(null);
    if (onInspectPoint) onInspectPoint(null);
  }, [onInspectPoint]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width, dpr } = size;
    const height = CANVAS_HEIGHT;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    ctx.fillStyle = isLight ? '#ffffff' : '#080d1a';
    ctx.fillRect(0, 0, width, height);

    const numChannels = 4;
    const channelH = height / numChannels;

    const channels = [
      { name: 'CH1 • SPEED TRACE (km/h)', ticks: ['350', '175', '0'] },
      { name: 'CH2 • PEDALS: THROTTLE & BRAKE (%)', ticks: ['100%', '50%', '0%'] },
      { name: 'CH3 • STEERING ANGLE & POLE DELTA (s)', ticks: ['+0.5s', '0.0', '-0.5s'] },
      { name: 'CH4 • ENGINE RPM & GEARBOX', ticks: ['13k', '6.5k', 'G1-8'] },
    ];

    channels.forEach((ch, idx) => {
      const topY = idx * channelH;
      const bottomY = topY + channelH;

      ctx.strokeStyle = isLight ? 'rgba(15, 23, 42, 0.08)' : 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, bottomY);
      ctx.lineTo(width, bottomY);
      ctx.stroke();

      ctx.fillStyle = isLight ? '#475569' : '#94a3b8';
      ctx.font = 'bold 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(ch.name, 12, topY + 14);

      ctx.strokeStyle = isLight ? 'rgba(15, 23, 42, 0.04)' : 'rgba(255, 255, 255, 0.035)';
      ctx.beginPath();
      ctx.moveTo(0, topY + channelH / 2);
      ctx.lineTo(width, topY + channelH / 2);
      ctx.stroke();

      ctx.fillStyle = '#64748b';
      ctx.font = '9.5px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(ch.ticks[0], width - 8, topY + 13);
      ctx.fillText(ch.ticks[1], width - 8, topY + channelH / 2 + 3);
      ctx.fillText(ch.ticks[2], width - 8, bottomY - 5);
    });

    const primaryPts = (multiHistory[primaryDriver] || []).slice(-200);
    const targetW = Math.max(10, width - 44);

    const drawSeries = (pts, getY, color, lineWidth = 2, isDashed = false, shadow = false) => {
      if (!pts || pts.length === 0) return;
      const count = pts.length;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      if (isDashed) ctx.setLineDash([3, 3]);
      if (shadow && !isLight && !reducedMotion) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 6;
      }
      ctx.beginPath();

      if (count === 1) {
        const y = getY(pts[0]);
        ctx.moveTo(0, y);
        ctx.lineTo(targetW, y);
      } else {
        for (let i = 0; i < count; i++) {
          const x = (i / (count - 1)) * targetW;
          const y = getY(pts[i]);
          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            const prevX = ((i - 1) / (count - 1)) * targetW;
            const prevY = getY(pts[i - 1]);
            const midX = (prevX + x) / 2;
            ctx.quadraticCurveTo(prevX, prevY, midX, (prevY + y) / 2);
          }
        }
        ctx.lineTo(targetW, getY(pts[count - 1]));
      }

      ctx.stroke();
      ctx.restore();
    };

    // CHANNEL 1: SPEED OVERLAY
    let speedLegendX = 210;
    selectedDrivers.forEach((drv) => {
      const pts = (multiHistory[drv] || []).slice(-200);
      if (pts.length === 0) return;

      const prof = getDriverProfile(drv);
      const isPrimary = drv === primaryDriver;

      drawSeries(
        pts,
        (p) => {
          const norm = Math.min(1.0, Math.max(0, (p.speed || 0) / 350));
          return channelH - (norm * (channelH - 22) + 4);
        },
        prof.color,
        isPrimary ? 2.5 : 1.6,
        false,
        isPrimary
      );

      const lastPt = pts[pts.length - 1];
      if (lastPt && speedLegendX < width - 110) {
        ctx.fillStyle = prof.color;
        ctx.font = 'bold 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`${drv}: ${Math.round(lastPt.speed)} km/h`, speedLegendX, 14);
        speedLegendX += 100;
      }
    });

    // CHANNEL 2: PEDALS
    const ch2Top = channelH;
    if (primaryPts.length > 0) {
      drawSeries(
        primaryPts,
        (p) => {
          const thNorm = (p.throttle || 0) / 100;
          return ch2Top + channelH - (thNorm * (channelH - 20) + 4);
        },
        '#22c55e',
        2.2
      );
      drawSeries(
        primaryPts,
        (p) => {
          const brkNorm = (p.brake || 0) / 100;
          return ch2Top + channelH - (brkNorm * (channelH - 20) + 4);
        },
        '#ef4444',
        2
      );
    }

    selectedDrivers.forEach((drv) => {
      if (drv === primaryDriver) return;
      const pts = (multiHistory[drv] || []).slice(-200);
      if (pts.length === 0) return;
      const prof = getDriverProfile(drv);
      drawSeries(
        pts,
        (p) => {
          const thNorm = (p.throttle || 0) / 100;
          return ch2Top + channelH - (thNorm * (channelH - 20) + 4);
        },
        prof.color,
        1.3,
        true
      );
    });

    // CHANNEL 3: STEERING & DELTA
    const ch3Top = channelH * 2;
    const mid3Y = ch3Top + channelH / 2;

    if (primaryPts.length > 0) {
      drawSeries(
        primaryPts,
        (p) => {
          const st = Math.max(-1.0, Math.min(1.0, p.steer || 0));
          return mid3Y - st * (channelH / 2 - 8);
        },
        '#06b6d4',
        2
      );
    }

    selectedDrivers.forEach((drv) => {
      const pts = (multiHistory[drv] || []).slice(-200);
      if (pts.length === 0) return;
      const prof = getDriverProfile(drv);
      drawSeries(
        pts,
        (p) => {
          const delta = p.delta_to_ghost || 0;
          const deltaNorm = Math.max(-1.0, Math.min(1.0, delta / 0.6));
          return mid3Y + deltaNorm * (channelH / 2 - 8);
        },
        prof.color,
        drv === primaryDriver ? 1.8 : 1.4,
        drv === primaryDriver
      );
    });

    // CHANNEL 4: RPM & GEAR
    const ch4Top = channelH * 3;
    selectedDrivers.forEach((drv) => {
      const pts = (multiHistory[drv] || []).slice(-200);
      if (pts.length === 0) return;
      const prof = getDriverProfile(drv);
      const isPrimary = drv === primaryDriver;
      drawSeries(
        pts,
        (p) => {
          const rpmNorm = Math.min(1.0, Math.max(0, (p.rpm || 0) / 13500));
          return ch4Top + channelH - (rpmNorm * (channelH - 22) + 4);
        },
        isPrimary ? '#f59e0b' : prof.color,
        isPrimary ? 2.2 : 1.3,
        !isPrimary
      );
    });

    if (primaryPts.length > 0 && width >= 460) {
      const lastP = primaryPts[primaryPts.length - 1];
      if (lastP) {
        ctx.fillStyle = '#f59e0b';
        ctx.font = 'bold 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`RPM: ${Math.round(lastP.rpm)}`, 235, ch4Top + 14);

        ctx.fillStyle = isLight ? '#0f172a' : '#f8fafc';
        ctx.font = 'bold 11px "JetBrains Mono", monospace';
        ctx.fillText(`GEAR: ${lastP.gear === 0 ? 'N' : lastP.gear}`, 335, ch4Top + 14);
      }
    }

    ctx.strokeStyle = 'rgba(6, 182, 212, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 2]);
    ctx.beginPath();
    ctx.moveTo(targetW, 0);
    ctx.lineTo(targetW, height);
    ctx.stroke();
    ctx.setLineDash([]);

    if (hoverNormX != null && primaryPts.length > 0) {
      const cursorX = Math.max(0, Math.min(targetW, hoverNormX * width));
      const sliceRatio = targetW > 0 ? Math.max(0, Math.min(1, cursorX / targetW)) : 0;

      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cursorX, 0);
      ctx.lineTo(cursorX, height);
      ctx.stroke();

      const rows = selectedDrivers
        .map((drv) => {
          const pts = (multiHistory[drv] || []).slice(-200);
          if (pts.length === 0) return null;
          const idx = Math.min(pts.length - 1, Math.max(0, Math.round(sliceRatio * (pts.length - 1))));
          const pt = pts[idx];
          const prof = getDriverProfile(drv);
          return { drv, prof, pt };
        })
        .filter(Boolean);

      if (rows.length > 0) {
        const boxW = Math.min(248, width - 16);
        const boxH = 26 + rows.length * 18;
        const boxX = cursorX + 14 + boxW > width - 48 ? Math.max(8, cursorX - boxW - 14) : cursorX + 14;
        const boxY = 24;

        ctx.fillStyle = isLight ? 'rgba(255, 255, 255, 0.96)' : 'rgba(15, 23, 42, 0.94)';
        ctx.fillRect(boxX, boxY, boxW, boxH);
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1.2;
        ctx.strokeRect(boxX, boxY, boxW, boxH);

        const refPt = rows[0].pt;
        ctx.fillStyle = isLight ? '#475569' : '#94a3b8';
        ctx.font = 'bold 9.5px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(
          `DIST ${((refPt.distance || 0) / 1000).toFixed(2)}km • SEC ${refPt.sector || 1}`,
          boxX + 8,
          boxY + 14
        );

        rows.forEach(({ drv, prof, pt }, rIdx) => {
          const ry = boxY + 30 + rIdx * 18;
          ctx.fillStyle = prof.color;
          ctx.font = 'bold 10px "JetBrains Mono", monospace';
          ctx.fillText(
            `${drv} ${Math.round(pt.speed)}k G${pt.gear} T:${Math.round(pt.throttle)}% B:${Math.round(pt.brake)}% Δ:${(pt.delta_to_ghost || 0).toFixed(2)}s`,
            boxX + 8,
            ry
          );
        });
      }
    }

    ctx.restore();
  }, [multiHistory, selectedDrivers, primaryDriver, isLight, size, hoverNormX, reducedMotion]);

  return (
    <div className="telemetry-canvas-card card" id="telemetry-canvas-card">
      <div className="telemetry-canvas__header">
        <div className="telemetry-canvas__title-group">
          <span className="telemetry-canvas__badge">60 FPS OSCILLOSCOPE</span>
          <h3 className="telemetry-canvas__title">
            High-Frequency Telemetry Overlay <small className="telemetry-canvas__hint">(Hover to inspect)</small>
          </h3>
        </div>
        <div className="telemetry-canvas__legend">
          {selectedDrivers.map((d) => {
            const prof = getDriverProfile(d);
            return (
              <span key={d} className="legend-tag font-mono" title={prof.name}>
                <span className="legend-dot" style={{ backgroundColor: prof.color }} aria-hidden="true"></span>
                <span style={{ color: prof.color, fontWeight: 700 }}>{d} #{prof.number}</span>
              </span>
            );
          })}
          <span className="legend-tag font-mono">
            <span className="legend-dot" style={{ backgroundColor: '#22c55e' }} aria-hidden="true"></span>
            <span>Throttle</span>
          </span>
          <span className="legend-tag font-mono">
            <span className="legend-dot" style={{ backgroundColor: '#ef4444' }} aria-hidden="true"></span>
            <span>Brake</span>
          </span>
          <span className="legend-tag font-mono">
            <span className="legend-dot" style={{ backgroundColor: '#06b6d4' }} aria-hidden="true"></span>
            <span>Steer</span>
          </span>
        </div>
      </div>
      <div className="telemetry-canvas__body" ref={containerRef}>
        <canvas
          ref={canvasRef}
          width={Math.round(size.width * size.dpr)}
          height={Math.round(CANVAS_HEIGHT * size.dpr)}
          style={{ width: `${size.width}px`, height: `${CANVAS_HEIGHT}px` }}
          className="telemetry-canvas"
          aria-label="4-channel multi-driver telemetry oscilloscope"
          onMouseMove={(e) => handlePointerMove(e.clientX)}
          onMouseLeave={handleMouseLeave}
          onTouchMove={(e) => {
            if (e.touches && e.touches[0]) {
              handlePointerMove(e.touches[0].clientX);
            }
          }}
          onTouchEnd={handleMouseLeave}
        />
      </div>
    </div>
  );
}

export default memo(TelemetryCanvas);
