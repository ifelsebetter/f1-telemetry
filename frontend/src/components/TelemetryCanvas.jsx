import { useEffect, useRef, useState, memo } from 'react';
import { useTheme } from '../hooks/useTheme';
import { getDriverProfile } from '../services/circuitData';
import './TelemetryCanvas.css';

function TelemetryCanvas({
  multiHistory = {},
  selectedDrivers = ['VER'],
  primaryDriver = 'VER',
}) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const [canvasWidth, setCanvasWidth] = useState(1100);
  const { theme } = useTheme();
  const isLight = theme === 'light';

  // Responsive dynamic width matching container card exactly
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 50) {
        setCanvasWidth(Math.floor(rect.width));
      }
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    // Background
    ctx.fillStyle = isLight ? '#ffffff' : '#080d1a';
    ctx.fillRect(0, 0, width, height);

    // 4 vertical channels:
    // 1: SPEED (0 - 350 km/h)
    // 2: PEDALS: THROTTLE (100%) & BRAKE
    // 3: DELTA & STEERING
    // 4: GEAR & RPM
    const numChannels = 4;
    const channelH = height / numChannels;

    const channels = [
      { name: 'SPEED (km/h)', unit: 'km/h', maxVal: 350 },
      { name: 'PEDALS: THROTTLE (100%) & BRAKE', unit: '%', maxVal: 100 },
      { name: 'STEERING & DELTA TRACE', unit: 'rad', maxVal: 1.0 },
      { name: 'ENGINE RPM & GEARBOX', unit: 'rpm', maxVal: 13000 },
    ];

    channels.forEach((ch, idx) => {
      const topY = idx * channelH;
      const bottomY = topY + channelH;

      // Divider line
      ctx.strokeStyle = isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, bottomY);
      ctx.lineTo(width, bottomY);
      ctx.stroke();

      // Channel Header
      ctx.fillStyle = isLight ? '#64748b' : '#94a3b8';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(ch.name, 12, topY + 14);

      // Midline / reference grid
      ctx.strokeStyle = isLight ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.03)';
      ctx.beginPath();
      ctx.moveTo(0, topY + channelH / 2);
      ctx.lineTo(width, topY + channelH / 2);
      ctx.stroke();
    });

    const primaryPts = (multiHistory[primaryDriver] || []).slice(-200);
    const targetW = Math.max(10, width - 4);

    // Helper: interpolate & draw smooth continuous curve spanning 0 to targetW
    const drawSeries = (pts, getY, color, lineWidth = 2, isDashed = false, shadow = false) => {
      if (!pts || pts.length === 0) return;
      const count = pts.length;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      if (isDashed) ctx.setLineDash([3, 3]);
      if (shadow && !isLight) {
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

    // ==========================================
    // CHANNEL 1: SPEED OVERLAY (All selected drivers)
    // ==========================================
    let speedLegendX = 120;
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
        isPrimary ? 2.5 : 1.5,
        false,
        isPrimary
      );

      // Header readout
      const lastPt = pts[pts.length - 1];
      if (lastPt) {
        ctx.fillStyle = prof.color;
        ctx.font = 'bold 9px "JetBrains Mono", monospace';
        ctx.fillText(`${drv}: ${Math.round(lastPt.speed)} km/h`, speedLegendX, 14);
        speedLegendX += 95;
      }
    });

    // ==========================================
    // CHANNEL 2: PEDALS (Throttle & Brake)
    // ==========================================
    const ch2Top = channelH;

    if (primaryPts.length > 0) {
      // Throttle for primary car (green)
      drawSeries(
        primaryPts,
        (p) => {
          const thNorm = (p.throttle || 0) / 100;
          return ch2Top + channelH - (thNorm * (channelH - 20) + 4);
        },
        '#22c55e',
        2
      );

      // Brake for primary car (red)
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

    // Comparison driver throttles (subtle dashed overlay)
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
        1.2,
        true
      );
    });

    // ==========================================
    // CHANNEL 3: STEERING & DELTA
    // ==========================================
    const ch3Top = channelH * 2;
    const mid3Y = ch3Top + channelH / 2;

    if (primaryPts.length > 0) {
      // Steering curve for primary car
      drawSeries(
        primaryPts,
        (p) => {
          const st = Math.max(-1.0, Math.min(1.0, p.steer || 0));
          return mid3Y - st * (channelH / 2 - 8);
        },
        '#38bdf8',
        1.8
      );
    }

    // Delta curve for comparison driver
    const compDrv = selectedDrivers.find((d) => d !== primaryDriver);
    if (compDrv) {
      const compPts = (multiHistory[compDrv] || []).slice(-200);
      if (compPts.length > 0) {
        const prof = getDriverProfile(compDrv);
        drawSeries(
          compPts,
          (p) => {
            const delta = p.delta_to_ghost || 0;
            const deltaNorm = Math.max(-1.0, Math.min(1.0, delta / 0.5));
            return mid3Y + deltaNorm * (channelH / 2 - 8);
          },
          prof.color,
          1.5
        );

        ctx.fillStyle = prof.color;
        ctx.font = '9px "JetBrains Mono", monospace';
        ctx.fillText(`Δ ${compDrv} vs ${primaryDriver}`, width - 140, ch3Top + 14);
      }
    }

    // ==========================================
    // CHANNEL 4: RPM & GEAR
    // ==========================================
    const ch4Top = channelH * 3;

    if (primaryPts.length > 0) {
      // RPM Curve
      drawSeries(
        primaryPts,
        (p) => {
          const rpmNorm = Math.min(1.0, Math.max(0, (p.rpm || 0) / 13000));
          return ch4Top + channelH - (rpmNorm * (channelH - 22) + 4);
        },
        '#f59e0b',
        2
      );

      // Gear indicator text readout
      const lastP = primaryPts[primaryPts.length - 1];
      if (lastP) {
        ctx.fillStyle = '#f59e0b';
        ctx.font = 'bold 10px "JetBrains Mono", monospace';
        ctx.fillText(`RPM: ${Math.round(lastP.rpm)}`, 160, ch4Top + 14);

        ctx.fillStyle = isLight ? '#0f172a' : '#f8fafc';
        ctx.font = 'bold 11px "JetBrains Mono", monospace';
        ctx.fillText(`GEAR: ${lastP.gear === 0 ? 'N' : lastP.gear}`, 270, ch4Top + 14);
      }
    }

    // Current cursor line at trailing right edge
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 2]);
    ctx.beginPath();
    ctx.moveTo(width - 2, 0);
    ctx.lineTo(width - 2, height);
    ctx.stroke();
    ctx.setLineDash([]);
  }, [multiHistory, selectedDrivers, primaryDriver, isLight, canvasWidth]);

  return (
    <div className="telemetry-canvas-card card" id="telemetry-canvas-card">
      <div className="telemetry-canvas__header">
        <div className="telemetry-canvas__title-group">
          <span className="telemetry-canvas__badge">60 FPS OSCILLOSCOPE</span>
          <h3 className="telemetry-canvas__title">High-Frequency Telemetry Overlay</h3>
        </div>
        <div className="telemetry-canvas__legend">
          {selectedDrivers.map((d) => {
            const prof = getDriverProfile(d);
            return (
              <span key={d} className="legend-tag font-mono" title={prof.name}>
                <span className="legend-dot" style={{ backgroundColor: prof.color }}></span>
                <span style={{ color: prof.color, fontWeight: 700 }}>{d} #{prof.number}</span>
              </span>
            );
          })}
          <span className="legend-tag font-mono">
            <span className="legend-dot" style={{ backgroundColor: '#22c55e' }}></span>
            <span>Throttle</span>
          </span>
          <span className="legend-tag font-mono">
            <span className="legend-dot" style={{ backgroundColor: '#ef4444' }}></span>
            <span>Brake</span>
          </span>
        </div>
      </div>
      <div className="telemetry-canvas__body" ref={containerRef}>
        <canvas
          ref={canvasRef}
          width={canvasWidth}
          height={380}
          className="telemetry-canvas"
        />
      </div>
    </div>
  );
}

export default memo(TelemetryCanvas);
