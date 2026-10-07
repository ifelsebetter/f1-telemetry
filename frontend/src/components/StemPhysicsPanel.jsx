import { useState, memo } from 'react';
import './StemPhysicsPanel.css';

function StemPhysicsPanel({ currentPoint }) {
  const [activeTopic, setActiveTopic] = useState('downforce');

  const p = currentPoint || {};
  const speedKmh = p.speed || 0;
  const speedMs = speedKmh / 3.6;
  const brakePct = (p.brake || 0) / 100;
  const throttlePct = (p.throttle || 0) / 100;
  const steer = Math.abs(p.steer || 0);
  const drs = Boolean(p.drs);

  // 1. Aerodynamic Downforce Calculations
  // F_z = 0.5 * rho * v^2 * Cl * A
  // rho = 1.225 kg/m^3, Cl*A ~ 3.5 (standard modern ground-effect floor)
  // When DRS open, Cl*A drops slightly to 2.8, Cd*A drops ~25%
  const rho = 1.225;
  const clA = drs ? 2.8 : 3.6;
  const downforceNewtons = 0.5 * rho * Math.pow(speedMs, 2) * clA;
  const downforceKg = downforceNewtons / 9.81;

  // Car curb weight ~ 798 kg
  const carMassKg = 798;
  const downforceRatio = ((downforceKg / carMassKg) * 100).toFixed(0);

  // 2. Regenerative Braking & MGU-K Power
  // Max FIA 120 kW (160 bhp)
  const regenKw = brakePct * 120.0;
  const regenBhp = regenKw * 1.341;
  // Kinetic energy: E_k = 0.5 * m * v^2 in Megajoules (MJ)
  const kineticEnergyMJ = (0.5 * (carMassKg + 80) * Math.pow(speedMs, 2)) / 1_000_000;

  // 3. Friction Ellipse (Kamm's Circle)
  // Longitudinal acceleration G ~ brake/throttle
  const gLong = brakePct > 0 ? -brakePct * 4.8 : throttlePct * 1.8;
  // Lateral acceleration G ~ v^2 / r ~ steer * v
  const gLat = steer * (speedKmh / 65);
  const totalG = Math.sqrt(Math.pow(gLong, 2) + Math.pow(gLat, 2));
  const frictionLimitG = 5.2; // Peak soft tyre grip with downforce
  const gripUtilizationPct = Math.min(100, (totalG / frictionLimitG) * 100);

  return (
    <div className="stem-panel card" id="stem-panel">
      <div className="stem__header">
        <div className="stem__title-group">
          <span className="stem__badge">STEM EXHIBIT</span>
          <h3 className="stem__title">Applied F1 Engineering & Physics Engine</h3>
        </div>
        <div className="stem__tabs">
          <button
            type="button"
            className={`stem-tab ${activeTopic === 'downforce' ? 'tab-active' : ''}`}
            onClick={() => setActiveTopic('downforce')}
          >
            Aerodynamics (F_z)
          </button>
          <button
            type="button"
            className={`stem-tab ${activeTopic === 'regen' ? 'tab-active' : ''}`}
            onClick={() => setActiveTopic('regen')}
          >
            Regenerative MGU-K
          </button>
          <button
            type="button"
            className={`stem-tab ${activeTopic === 'friction' ? 'tab-active' : ''}`}
            onClick={() => setActiveTopic('friction')}
          >
            Friction Ellipse
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
                <span className="m-sub">{(downforceNewtons / 1000).toFixed(1)} kN of downforce</span>
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
                <span className="m-sub">{drs ? 'Cd reduced by ~22%' : 'Full venturi ground effect'}</span>
              </div>
            </div>

            <div className="stem-equation-box font-mono">
              <span className="eq-title">GOVERNING EQUATION:</span>
              <code>F_z = ½ • ρ • v² • (C_L • A)</code>
              <p className="eq-explanation">
                Downforce scales with the <strong>square of velocity (v²)</strong>. At 300 km/h, the car produces over 
                1,500 kg of aerodynamic load—allowing the car to theoretically drive upside down on the ceiling of a tunnel.
              </p>
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

            <div className="stem-equation-box font-mono">
              <span className="eq-title">ENERGY RECOVERY PRINCIPLE:</span>
              <code>P = τ • ω = V • I ≤ 120 kW (FIA Tech Reg Art. 5.12)</code>
              <p className="eq-explanation">
                The Motor Generator Unit - Kinetic (MGU-K) acts as an electromagnetic brake on the rear axle, converting 
                kinetic energy that would otherwise be wasted as brake rotor heat into electrochemical storage.
              </p>
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

            <div className="stem-equation-box font-mono">
              <span className="eq-title">KAMM'S CIRCLE / FRICTION ELLIPSE:</span>
              <code>√(F_long² + F_lat²) ≤ μ • F_z</code>
              <p className="eq-explanation">
                A tyre has a finite adhesion envelope. If a driver demands 100% longitudinal braking force, 0% lateral 
                turning force is available. As the driver turns the wheel toward the corner apex, they must smoothly 
                release the brake pedal ("trail braking") to stay within the ellipse and avoid lockup.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(StemPhysicsPanel);
