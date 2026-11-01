import { memo } from 'react';
import { getDriverProfile } from '../services/circuitData';
import './PitWallHUD.css';

function getTyreColor(temp) {
  if (temp < 85) return '#38bdf8';
  if (temp <= 104) return '#22c55e';
  if (temp <= 112) return '#eab308';
  return '#ef4444';
}

function getSectorBadge(sectorIndex, activeSector, ghostDelta) {
  if (sectorIndex > activeSector) {
    return { label: 'PENDING', cls: 'pending-sector', active: false };
  }
  if (sectorIndex === activeSector) {
    if (ghostDelta <= -0.05) return { label: 'PURPLE', cls: 'purple-sector', active: true };
    if (ghostDelta <= 0.12) return { label: 'GREEN', cls: 'green-sector', active: true };
    return { label: 'YELLOW', cls: 'yellow-sector', active: true };
  }
  // Completed sector
  const offset = sectorIndex === 1 ? -0.04 : 0.03;
  const effDelta = ghostDelta + offset;
  if (effDelta <= -0.03) return { label: 'PURPLE', cls: 'purple-sector', active: false };
  if (effDelta <= 0.15) return { label: 'GREEN', cls: 'green-sector', active: false };
  return { label: 'YELLOW', cls: 'yellow-sector', active: false };
}

function PitWallHUD({
  currentPoint,
  primaryDriver = 'VER',
  selectedDrivers = ['VER'],
  multiPoints = {},
}) {
  const p = currentPoint || {};

  const ersSoc = p.ers_soc ?? 95.0;
  const ersHarvest = p.ers_harvest ?? 0.0;
  const ghostDelta = p.delta_to_ghost ?? 0.0;
  const compound = p.tyre_compound || 'SOFT';
  const tyreWear = p.tyre_wear ?? 8.5;
  const speed = Math.round(p.speed ?? 0);
  const liveSpeedMs = p.live_speed_ms != null ? p.live_speed_ms : Number((speed / 3.6).toFixed(1));
  const liveEta = p.eta_seconds != null ? `${p.eta_seconds.toFixed(1)}s` : '--';
  const liveDistance = p.distance != null ? `${(p.distance / 1000).toFixed(2)} km` : '0.00 km';
  const rpm = Math.round(p.rpm ?? 0);
  const gear = p.gear ?? 0;
  const throttle = Math.round(p.throttle ?? 0);
  const brake = Math.round(p.brake ?? 0);
  const activeSector = p.sector ?? 1;

  const tempFL = p.tyre_temp_fl ?? 94;
  const tempFR = p.tyre_temp_fr ?? 96;
  const tempRL = p.tyre_temp_rl ?? 97;
  const tempRR = p.tyre_temp_rr ?? 98;

  const colorFL = getTyreColor(tempFL);
  const colorFR = getTyreColor(tempFR);
  const colorRL = getTyreColor(tempRL);
  const colorRR = getTyreColor(tempRR);

  const primaryProf = getDriverProfile(primaryDriver);

  // All selected comparison rivals
  const rivals = selectedDrivers
    .filter((d) => d !== primaryDriver && multiPoints[d])
    .map((code) => ({
      code,
      prof: getDriverProfile(code),
      pt: multiPoints[code],
    }));

  // Rev lights calculation (15 shift lights)
  const maxRpm = 13000;
  const rpmPercent = Math.min(100, Math.max(0, ((rpm - 4000) / (maxRpm - 4000)) * 100));
  const activeLeds = Math.round((rpmPercent / 100) * 15);

  const s1Badge = getSectorBadge(1, activeSector, ghostDelta);
  const s2Badge = getSectorBadge(2, activeSector, ghostDelta);
  const s3Badge = getSectorBadge(3, activeSector, ghostDelta);

  return (
    <div className="pit-wall-hud card" id="pit-wall-hud">
      {/* Top Cockpit Broadcast HUD Bar */}
      <div className="hud__cockpit-bar">
        {/* Gear & RPM LEDs */}
        <div className="cockpit__gear-module">
          <div className="gear-display font-mono">
            <span className="gear-num">{gear === 0 ? 'N' : gear}</span>
            <span className="gear-sub">GEAR</span>
          </div>
          <div className="rev-lights-wrapper">
            <div className="rev-lights-row">
              {Array.from({ length: 15 }).map((_, i) => {
                const isActive = i < activeLeds;
                let ledType = 'led-green';
                if (i >= 10 && i < 13) ledType = 'led-red';
                if (i >= 13) ledType = 'led-blue';

                return (
                  <span
                    key={i}
                    className={`rev-led ${ledType} ${isActive ? 'active' : ''}`}
                  ></span>
                );
              })}
            </div>
            <div className="rpm-text font-mono">
              <span>{rpm} RPM</span>
              <span className="driver-tag" style={{ color: primaryProf.color }}>
                {primaryDriver} #{primaryProf.number}
              </span>
            </div>
          </div>
        </div>

        {/* Speed Trap & Pedals */}
        <div className="cockpit__speed-module">
          <div className="speed-readout font-mono">
            <span className="speed-val">{speed}</span>
            <span className="speed-unit">KM/H</span>
            <span className="speed-sub">{liveSpeedMs} M/S</span>
          </div>

          <div className="speed-eta-badge font-mono">
            <span className="eta-badge__label">LAP ETA</span>
            <span className="eta-badge__val">{liveEta}</span>
            <span className="eta-badge__dist">{liveDistance}</span>
          </div>

          <div className="pedals-display">
            <div className="pedal-col">
              <span className="pedal-name font-mono">THR</span>
              <div className="pedal-bar-track">
                <div
                  className="pedal-bar-fill fill-throttle"
                  style={{ height: `${throttle}%` }}
                ></div>
              </div>
              <span className="pedal-pct font-mono">{throttle}%</span>
            </div>
            <div className="pedal-col">
              <span className="pedal-name font-mono">BRK</span>
              <div className="pedal-bar-track">
                <div
                  className="pedal-bar-fill fill-brake"
                  style={{ height: `${brake}%` }}
                ></div>
              </div>
              <span className="pedal-pct font-mono">{brake}%</span>
            </div>
          </div>
        </div>

        {/* Multi-Driver Comparison Delta */}
        {rivals.length > 0 && (
          <div className="cockpit__vs-module">
            <span className="vs-badge font-mono">
              MULTI-CAR DELTA VS {primaryDriver}
            </span>
            <div className="vs-rivals-list font-mono">
              {rivals.map(({ code, prof, pt }) => {
                const rSpeed = Math.round(pt.speed ?? 0);
                const diffKmh = speed - rSpeed;
                const timeDiff = (pt.delta_to_ghost ?? 0) - ghostDelta;
                return (
                  <div key={code} className="vs-rival-row">
                    <span className="vs-rival-code" style={{ color: prof.color }}>
                      {code}
                    </span>
                    <span className="vs-rival-speed">{rSpeed}k (G{pt.gear ?? 0})</span>
                    <span className={diffKmh >= 0 ? 'delta-ahead' : 'delta-behind'}>
                      {diffKmh >= 0 ? `+${diffKmh}` : diffKmh} km/h
                    </span>
                    <span className="vs-rival-dt">
                      {timeDiff >= 0 ? `+${timeDiff.toFixed(2)}s` : `${timeDiff.toFixed(2)}s`}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Grid: ERS & Tyres & Ghost Delta */}
      <div className="hud__grid">
        {/* Tyre Thermal Matrix */}
        <div className="hud__card tyre-thermal-card">
          <div className="card__header">
            <h4>TYRE THERMAL DYNAMICS</h4>
            <span className={`compound-pill compound-${compound.toLowerCase()}`}>
              {compound}
            </span>
          </div>
          <div className="tyre-car-diagram">
            <div className="car-chassis">
              {/* Front Axle */}
              <div className="tyre-axle">
                <div className="tyre-box" style={{ borderColor: colorFL }}>
                  <span className="tyre-label">FL</span>
                  <span className="tyre-temp" style={{ color: colorFL }}>
                    {tempFL.toFixed(1)}°C
                  </span>
                </div>
                <div className="axle-rod"></div>
                <div className="tyre-box" style={{ borderColor: colorFR }}>
                  <span className="tyre-label">FR</span>
                  <span className="tyre-temp" style={{ color: colorFR }}>
                    {tempFR.toFixed(1)}°C
                  </span>
                </div>
              </div>

              {/* Chassis Silhouette */}
              <div className="chassis-body">
                <span className="chassis-number">#{primaryProf.number}</span>
                <span className="chassis-wear">WEAR: {tyreWear.toFixed(1)}%</span>
              </div>

              {/* Rear Axle */}
              <div className="tyre-axle">
                <div className="tyre-box" style={{ borderColor: colorRL }}>
                  <span className="tyre-label">RL</span>
                  <span className="tyre-temp" style={{ color: colorRL }}>
                    {tempRL.toFixed(1)}°C
                  </span>
                </div>
                <div className="axle-rod"></div>
                <div className="tyre-box" style={{ borderColor: colorRR }}>
                  <span className="tyre-label">RR</span>
                  <span className="tyre-temp" style={{ color: colorRR }}>
                    {tempRR.toFixed(1)}°C
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="tyre-temp-legend font-mono">
            <span className="leg-cool">&lt;85°C Cool</span>
            <span className="leg-opt">85-104°C Opt</span>
            <span className="leg-hot">&gt;105°C Hot</span>
          </div>
        </div>

        {/* ERS Hybrid Power Unit */}
        <div className="hud__card ers-card">
          <div className="card__header">
            <h4>HYBRID ERS ENERGY</h4>
            <span className="ers-mode-tag font-mono">
              {ersHarvest > 0 ? 'MODE: REGEN' : throttle > 85 ? 'DEPLOY: OVERTAKE' : 'DEPLOY: BALANCED'}
            </span>
          </div>
          <div className="ers-content">
            <div className="ers-gauge-row font-mono">
              <span className="ers-metric-title">BATTERY STATE OF CHARGE</span>
              <span className="ers-metric-val">{ersSoc.toFixed(1)}%</span>
            </div>
            <div className="ers-bar-outer">
              <div
                className="ers-bar-inner"
                style={{ width: `${Math.max(5, ersSoc)}%` }}
              ></div>
            </div>

            <div className="ers-harvest-row font-mono">
              <div className="harvest-box">
                <span className="harvest-label">MGU-K HARVEST RATE</span>
                <span className="harvest-val">
                  {ersHarvest > 0 ? `+${ersHarvest.toFixed(1)} kW` : '0.0 kW'}
                </span>
              </div>
              <div className="harvest-status">
                <span
                  className={`regen-dot ${ersHarvest > 0 ? 'regen-active' : ''}`}
                ></span>
                <span>{ersHarvest > 0 ? 'REGENERATING' : 'IDLE'}</span>
              </div>
            </div>

            <div className="ers-note font-mono">
              FIA 120 kW Peak Harvest Limit • MGU-K Active Under Braking
            </div>
          </div>
        </div>

        {/* Reference Lap Split Delta */}
        <div className="hud__card delta-card">
          <div className="card__header">
            <h4>POLE REFERENCE DELTA</h4>
            <span className="delta-target font-mono">TARGET: P1 BENCHMARK</span>
          </div>
          <div className="delta-content">
            <div className="delta-big-display font-mono">
              <span
                className={`delta-number ${
                  ghostDelta <= 0 ? 'delta-ahead' : 'delta-behind'
                }`}
              >
                {ghostDelta <= 0
                  ? `${ghostDelta.toFixed(3)}s`
                  : `+${ghostDelta.toFixed(3)}s`}
              </span>
              <span className="delta-subtext">
                {ghostDelta <= 0 ? 'FASTER THAN POLE' : 'BEHIND POLE REFERENCE'}
              </span>
            </div>
            <div className="sector-splits-row font-mono">
              {[
                { idx: 1, name: 'S1', badge: s1Badge },
                { idx: 2, name: 'S2', badge: s2Badge },
                { idx: 3, name: 'S3', badge: s3Badge },
              ].map(({ idx, name, badge }) => (
                <div key={idx} className="s-split">
                  <span className="s-name">{name}</span>
                  <span className={`s-status ${badge.cls}`}>
                    <span>{badge.label}</span>
                    {badge.active && (
                      <svg
                        viewBox="0 0 8 8"
                        width="7"
                        height="7"
                        fill="currentColor"
                        aria-hidden="true"
                        className="s-status__dot"
                      >
                        <circle cx="4" cy="4" r="3.5" />
                      </svg>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(PitWallHUD);
