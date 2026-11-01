import { useState, memo } from 'react';
import './StemPhysicsPanel.css';

function StemPhysicsPanel({ currentPoint }) {
  const [activeTopic, setActiveTopic] = useState('downforce');

  const p = currentPoint || {};
  const speedKmh = p.speed || 0;
  const speedMs = speedKmh / 3.6;
  const brakePct = (p.brake || 0) / 100;
  const throttlePct = (p.throttle || 0) / 100;
  const rawSteer = Number(p.steer || 0);
  const steer = Math.abs(rawSteer);
  const drs = Boolean(p.drs);
  const ersSoc = Number(p.ers_soc ?? 95);
  const ersHarvest = Number(p.ers_harvest ?? brakePct * 120);

  // 1. Aerodynamic Downforce Calculations
  const rho = 1.225;
  const clA = drs ? 2.8 : 3.6;
  const downforceNewtons = 0.5 * rho * Math.pow(speedMs, 2) * clA;
  const downforceKg = downforceNewtons / 9.81;

  const carMassKg = 798;
  const downforceRatio = ((downforceKg / carMassKg) * 100).toFixed(0);
  const aeroBarPct = Math.min(100, (downforceKg / 1800) * 100);
  const massBarPct = (carMassKg / 1800) * 100;

  // 2. Regenerative Braking & MGU-K Power
  const regenKw = ersHarvest > 0 ? ersHarvest : brakePct * 120.0;
  const regenBhp = regenKw * 1.341;
  const deployKw = throttlePct > 0.85 && brakePct === 0 ? 120.0 : throttlePct * 60.0;
  const kineticEnergyMJ = (0.5 * (carMassKg + 80) * Math.pow(speedMs, 2)) / 1_000_000;

  // 3. Friction Ellipse (Kamm's Circle)
  const gLong = brakePct > 0 ? -brakePct * 4.8 : throttlePct * 1.8;
  const gLatSigned = rawSteer * (speedKmh / 65);
  const gLat = Math.abs(gLatSigned);
  const totalG = Math.sqrt(Math.pow(gLong, 2) + Math.pow(gLat, 2));
  const frictionLimitG = 5.2;
  const gripUtilizationPct = Math.min(100, (totalG / frictionLimitG) * 100);

  // G-G Circle SVG coordinates (center 70, 70, radius 52 = 5.2G => 10px per G)
  const ggDotX = Math.max(18, Math.min(122, 70 + gLatSigned * 10));
  const ggDotY = Math.max(18, Math.min(122, 70 - gLong * 10));

  return (
    <div className="stem-panel card" id="stem-panel">
      <div className="stem__header">
        <div className="stem__title-group">
          <span className="stem__badge">STEM EXHIBIT</span>
          <h3 className="stem__title">Applied F1 Engineering & Physics Engine</h3>
        </div>
        <div className="stem__tabs" role="tablist" aria-label="Physics topics">
          <button
            type="button"
            role="tab"
            aria-selected={activeTopic === 'downforce'}
            className={`stem-tab ${activeTopic === 'downforce' ? 'tab-active' : ''}`}
            onClick={() => setActiveTopic('downforce')}
          >
            <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M7 2v9" />
              <polyline points="3.5 8 7 11.5 10.5 8" />
            </svg>
            <span>Aerodynamics (F_z)</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTopic === 'regen'}
            className={`stem-tab ${activeTopic === 'regen' ? 'tab-active' : ''}`}
            onClick={() => setActiveTopic('regen')}
          >
            <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polygon points="8 1.5 3.5 8 7 8 6 12.5 10.5 6 7 6 8 1.5" />
            </svg>
            <span>Regenerative MGU-K</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTopic === 'friction'}
            className={`stem-tab ${activeTopic === 'friction' ? 'tab-active' : ''}`}
            onClick={() => setActiveTopic('friction')}
          >
            <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="7" cy="7" r="5" />
              <circle cx="7" cy="7" r="1.5" fill="currentColor" />
            </svg>
            <span>Friction Ellipse (G-G)</span>
          </button>
        </div>
      </div>

      <div className="stem__content">
        {activeTopic === 'downforce' && (
          <div className="stem-topic">
            <div className="topic-metrics-grid">
              <div className="stem-metric-card">
                <span className="m-label">VERTICAL DOWNFORCE</span>
                <span className="m-val cyan-glow">{downforceKg.toFixed(0)} kg</span>
                <span className="m-sub">{(downforceNewtons / 1000).toFixed(1)} kN of aero load</span>
              </div>
              <div className="stem-metric-card">
                <span className="m-label">WEIGHT MULTIPLIER</span>
                <span className="m-val">{downforceRatio}%</span>
                <span className="m-sub">Relative to 798kg car mass</span>
              </div>
              <div className="stem-metric-card">
                <span className="m-label">AERO CONFIG</span>
                <span className={`m-badge ${drs ? 'badge-drs-open' : 'badge-high-downforce'}`}>
                  {drs ? 'DRS OPEN (LOW DRAG)' : 'HIGH DOWNFORCE'}
                </span>
                <span className="m-sub">{drs ? 'Cd reduced by ~22%' : 'Full Venturi ground effect'}</span>
              </div>
            </div>

            <div className="stem-visual-row">
              <div className="stem-diagram-card font-mono">
                <span className="diag-title">LIVE AERO LOAD VS CURB WEIGHT</span>
                <svg viewBox="0 0 320 76" className="stem-svg" aria-label="Aero downforce vs car mass chart">
                  <text x="6" y="22" fontSize="10" fill="currentColor" opacity="0.75">MASS (798kg)</text>
                  <rect x="98" y="11" width="210" height="14" rx="4" fill="rgba(148,163,184,0.18)" />
                  <rect x="98" y="11" width={(massBarPct / 100) * 210} height="14" rx="4" fill="#64748b" />

                  <text x="6" y="52" fontSize="10" fill="currentColor" opacity="0.9">AERO F_z</text>
                  <rect x="98" y="41" width="210" height="14" rx="4" fill="rgba(6,182,212,0.14)" />
                  <rect x="98" y="41" width={Math.max(4, (aeroBarPct / 100) * 210)} height="14" rx="4" fill="#06b6d4" />
                  <line
                    x1={98 + (massBarPct / 100) * 210}
                    y1="6"
                    x2={98 + (massBarPct / 100) * 210}
                    y2="64"
                    stroke="#f59e0b"
                    strokeWidth="1.5"
                    strokeDasharray="3 2"
                  />
                  <text x={98 + (massBarPct / 100) * 210} y="72" fontSize="8.5" fill="#f59e0b" textAnchor="middle">
                    1.0x Weight Inversion Threshold
                  </text>
                </svg>
              </div>

              <div className="stem-equation-box font-mono">
                <span className="eq-title">GOVERNING EQUATION:</span>
                <code>F_z = ½ • ρ • v² • (C_L • A)</code>
                <p className="eq-explanation">
                  Downforce scales with the <strong>square of velocity (v²)</strong>. Once the cyan bar crosses the dashed
                  1.0x threshold (798 kg), aerodynamic suction exceeds gravity.
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTopic === 'regen' && (
          <div className="stem-topic">
            <div className="topic-metrics-grid">
              <div className="stem-metric-card">
                <span className="m-label">HARVEST POWER</span>
                <span className="m-val green-glow">{regenKw.toFixed(1)} kW</span>
                <span className="m-sub">+{regenBhp.toFixed(0)} hp electrical recovery</span>
              </div>
              <div className="stem-metric-card">
                <span className="m-label">CAR KINETIC ENERGY</span>
                <span className="m-val">{kineticEnergyMJ.toFixed(2)} MJ</span>
                <span className="m-sub">E_k = ½ • m • v²</span>
              </div>
              <div className="stem-metric-card">
                <span className="m-label">FIA REGULATIONS</span>
                <span className="m-val purple-glow">4.0 MJ / LAP</span>
                <span className="m-sub">Max electrical deployment to drivetrain</span>
              </div>
            </div>

            <div className="stem-visual-row">
              <div className="stem-diagram-card font-mono">
                <span className="diag-title">HYBRID MGU-K POWER FLOW</span>
                <svg viewBox="0 0 320 76" className="stem-svg" aria-label="MGU-K hybrid energy flow">
                  <rect x="8" y="18" width="84" height="40" rx="6" fill="rgba(34,197,94,0.14)" stroke="#22c55e" />
                  <text x="50" y="35" fontSize="9" fill="#22c55e" textAnchor="middle" fontWeight="700">REAR AXLE</text>
                  <text x="50" y="49" fontSize="9.5" fill="currentColor" textAnchor="middle">+{regenKw.toFixed(0)} kW</text>

                  <line x1="94" y1="38" x2="124" y2="38" stroke={regenKw > 0 ? '#22c55e' : '#64748b'} strokeWidth="2.5" strokeDasharray={regenKw > 0 ? '4 2' : 'none'} />

                  <rect x="126" y="14" width="76" height="48" rx="6" fill="rgba(59,130,246,0.15)" stroke="#3b82f6" />
                  <text x="164" y="33" fontSize="9" fill="#3b82f6" textAnchor="middle" fontWeight="700">ES BATTERY</text>
                  <text x="164" y="49" fontSize="11" fill="currentColor" textAnchor="middle" fontWeight="800">{ersSoc.toFixed(0)}%</text>

                  <line x1="204" y1="38" x2="230" y2="38" stroke={deployKw > 10 ? '#a855f7' : '#64748b'} strokeWidth="2.5" />

                  <rect x="232" y="18" width="80" height="40" rx="6" fill="rgba(168,85,247,0.14)" stroke="#a855f7" />
                  <text x="272" y="35" fontSize="9" fill="#a855f7" textAnchor="middle" fontWeight="700">MGU-K DEPLOY</text>
                  <text x="272" y="49" fontSize="9.5" fill="currentColor" textAnchor="middle">-{deployKw.toFixed(0)} kW</text>
                </svg>
              </div>

              <div className="stem-equation-box font-mono">
                <span className="eq-title">ENERGY RECOVERY PRINCIPLE:</span>
                <code>P = τ • ω = V • I ≤ 120 kW (FIA Tech Reg Art. 5.12)</code>
                <p className="eq-explanation">
                  The MGU-K acts as an electromagnetic generator under braking, converting rear-axle kinetic energy into
                  battery charge instead of brake disc heat.
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTopic === 'friction' && (
          <div className="stem-topic">
            <div className="topic-metrics-grid">
              <div className="stem-metric-card">
                <span className="m-label">TOTAL G-FORCE</span>
                <span className="m-val amber-glow">{totalG.toFixed(2)} G</span>
                <span className="m-sub">Vector sum of Long & Lat G</span>
              </div>
              <div className="stem-metric-card">
                <span className="m-label">GRIP UTILIZATION</span>
                <span className="m-val">{gripUtilizationPct.toFixed(0)}%</span>
                <span className="m-sub">Of maximum tyre contact patch</span>
              </div>
              <div className="stem-metric-card">
                <span className="m-label">TECHNIQUE</span>
                <span className="m-badge badge-trail">
                  {brakePct > 0 && steer > 0.1 ? 'TRAIL BRAKING ACTIVE' : 'STEADY STATE'}
                </span>
                <span className="m-sub">Longitudinal vs Lateral tradeoff</span>
              </div>
            </div>

            <div className="stem-visual-row">
              <div className="stem-diagram-card stem-diagram-card--gg font-mono">
                <svg viewBox="0 0 140 140" width="128" height="128" aria-label="G-G Friction Circle Diagram">
                  <circle cx="70" cy="70" r="52" fill="rgba(245,158,11,0.06)" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="3 2" />
                  <circle cx="70" cy="70" r="26" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="1" />
                  <line x1="12" y1="70" x2="128" y2="70" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1" />
                  <line x1="70" y1="12" x2="70" y2="128" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1" />
                  <text x="70" y="11" fontSize="7.5" fill="currentColor" opacity="0.65" textAnchor="middle">+ACCEL</text>
                  <text x="70" y="136" fontSize="7.5" fill="currentColor" opacity="0.65" textAnchor="middle">-BRAKE (5G)</text>
                  <line x1="70" y1="70" x2={ggDotX} y2={ggDotY} stroke="#06b6d4" strokeWidth="2" />
                  <circle cx={ggDotX} cy={ggDotY} r="5" fill="#f59e0b" stroke="#ffffff" strokeWidth="1.5" />
                </svg>
                <div className="gg-readout">
                  <span>LAT: {gLatSigned.toFixed(2)}G</span>
                  <span>LONG: {gLong.toFixed(2)}G</span>
                  <span>PEAK: 5.20G</span>
                </div>
              </div>

              <div className="stem-equation-box font-mono">
                <span className="eq-title">KAMM&apos;S CIRCLE / FRICTION ELLIPSE:</span>
                <code>√(F_long² + F_lat²) ≤ μ • F_z</code>
                <p className="eq-explanation">
                  A tyre has a finite adhesion envelope (dashed 5.2G circle). Trail braking blends longitudinal braking
                  with lateral cornering force along the perimeter of the circle.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(StemPhysicsPanel);
