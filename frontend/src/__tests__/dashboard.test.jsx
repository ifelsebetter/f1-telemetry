import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ThemeProvider } from '../context/ThemeContext';
import Header from '../components/Header';
import TimingTower from '../components/TimingTower';
import TrackMapCanvas from '../components/TrackMapCanvas';
import TelemetryCanvas from '../components/TelemetryCanvas';
import PitWallHUD from '../components/PitWallHUD';
import StemPhysicsPanel from '../components/StemPhysicsPanel';
import Dashboard from '../pages/Dashboard';
import { DRIVER_PROFILES } from '../services/circuitData';

const SAMPLE_SESSIONS = [
  { year: 2023, round: 1, session_type: 'R', event_name: 'Bahrain Grand Prix', circuit_id: 'bahrain' },
  { year: 2023, round: 6, session_type: 'R', event_name: 'Monaco Grand Prix', circuit_id: 'monaco' },
];

const SAMPLE_CIRCUIT = {
  id: 'bahrain',
  name: 'Bahrain International Circuit',
  location: 'Sakhir, Bahrain',
  waypoints: [
    { x: 100, y: 100, sector: 1, drs: 1 },
    { x: 300, y: 120, sector: 1, drs: 0 },
    { x: 500, y: 300, sector: 2, drs: 0 },
    { x: 250, y: 420, sector: 3, drs: 1 },
  ],
  turns: [{ num: 1, x: 300, y: 120 }],
};

// Mock Canvas 2D Context for jsdom
function createMockCanvasContext() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    setTransform: vi.fn(),
    drawImage: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    arc: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn((txt) => ({ width: String(txt).length * 6 })),
    setLineDash: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    shadowColor: '',
    shadowBlur: 0,
    font: '',
    textAlign: 'left',
  };
}

let mockReducedMotion = false;
let mockCtx = createMockCanvasContext();

beforeEach(() => {
  mockReducedMotion = false;
  mockCtx = createMockCanvasContext();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => mockCtx);
  HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn(() => ({
    width: 800,
    height: 480,
    top: 0,
    left: 0,
    right: 800,
    bottom: 480,
  }));

  global.ResizeObserver = class ResizeObserver {
    constructor(cb) {
      this.cb = cb;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  global.WebSocket = class MockWebSocket {
    static OPEN = 1;
    constructor() {
      this.readyState = 1;
    }
    send() {}
    close() {}
  };

  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      sessions: SAMPLE_SESSIONS,
      circuits: [SAMPLE_CIRCUIT],
      data: [],
      drivers_data: {},
    }),
  });

  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: query.includes('prefers-reduced-motion') ? mockReducedMotion : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Phase 8 Frontend Functional Regression Suite', () => {
  describe('Header Component', () => {
    it('renders preset race selector, toggles CUSTOM GP form, submits custom race, closes on Escape, and toggles theme', () => {
      const onSwitchRace = vi.fn();
      render(
        <ThemeProvider>
          <Header
            wsStatus="connected"
            sessions={SAMPLE_SESSIONS}
            activeSession={SAMPLE_SESSIONS[0]}
            activeCircuit={SAMPLE_CIRCUIT}
            onSwitchRace={onSwitchRace}
            currentPoint={{ flag: 'GREEN', safety_car: 'NONE' }}
          />
        </ThemeProvider>
      );

      expect(screen.getByText('APEX PITWALL')).toBeTruthy();
      expect(screen.getByText('TRACK GREEN')).toBeTruthy();

      // Switch preset session
      const select = screen.getByLabelText(/RACE EVENT:/i);
      fireEvent.change(select, { target: { value: '2023|6|R' } });
      expect(onSwitchRace).toHaveBeenCalledWith(
        expect.objectContaining({ year: 2023, round: 6, circuit_id: 'monaco' })
      );

      // Open CUSTOM GP form
      const customBtn = screen.getByRole('button', { name: /CUSTOM GP/i });
      fireEvent.click(customBtn);
      expect(screen.getByText('YEAR')).toBeTruthy();

      // Dismiss via Escape key
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByText('YEAR')).toBeNull();

      // Re-open and submit custom GP
      fireEvent.click(customBtn);
      const loadBtn = screen.getByRole('button', { name: /LOAD/i });
      fireEvent.click(loadBtn);
      expect(onSwitchRace).toHaveBeenCalledTimes(2);
      expect(screen.queryByText('YEAR')).toBeNull();

      // Theme toggle
      const themeBtn = screen.getByRole('button', { name: /Switch to light mode/i });
      fireEvent.click(themeBtn);
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });
  });

  describe('TimingTower Component', () => {
    const sampleGrid = Object.values(DRIVER_PROFILES).map((drv, idx) => ({
      ...drv,
      position: idx + 1,
      compound: idx % 2 === 0 ? 'SOFT' : 'MEDIUM',
      drs: idx === 1,
      speed: 310 - idx * 2,
      gap: idx === 0 ? 'LEADER' : `+${(idx * 1.2).toFixed(3)}s`,
      interval: idx === 0 ? 'LEADER' : '+1.200s',
    }));

    it('renders 20 drivers, toggles GAP/INT mode, displays DRS badge, handles click and keyboard selection, and collapses', () => {
      const onToggleDriver = vi.fn();
      const onSetPrimaryDriver = vi.fn();

      render(
        <TimingTower
          drivers={sampleGrid}
          selectedDrivers={['VER', 'NOR']}
          primaryDriver="VER"
          onToggleDriver={onToggleDriver}
          onSetPrimaryDriver={onSetPrimaryDriver}
          activeSession={SAMPLE_SESSIONS[0]}
        />
      );

      expect(screen.getByText('20 DRIVERS')).toBeTruthy();
      expect(screen.getByText('DRS')).toBeTruthy();

      // Toggle GAP / INT mode
      const modeBtn = screen.getByRole('button', { name: /MODE: GAP/i });
      fireEvent.click(modeBtn);
      expect(screen.getByRole('button', { name: /MODE: INT/i })).toBeTruthy();

      // Click driver row
      const items = screen.getAllByRole('listitem');
      expect(items.length).toBe(20);
      fireEvent.click(items[2]);
      expect(onToggleDriver).toHaveBeenCalledWith(sampleGrid[2].code);

      // Keyboard Enter and S on driver row
      fireEvent.keyDown(items[3], { key: 'Enter' });
      expect(onToggleDriver).toHaveBeenCalledWith(sampleGrid[3].code);
      fireEvent.keyDown(items[3], { key: 's' });
      expect(onSetPrimaryDriver).toHaveBeenCalledWith(sampleGrid[3].code);

      // Collapse tower
      const collapseBtn = screen.getByRole('button', { name: /Collapse timing tower/i });
      fireEvent.click(collapseBtn);
      expect(screen.queryByText('20 DRIVERS')).toBeNull();
    });
  });

  describe('TrackMapCanvas & TelemetryCanvas Components (including Reduced Motion)', () => {
    const sampleHistory = {
      VER: Array.from({ length: 20 }, (_, i) => ({
        timestamp: i * 0.5,
        distance: i * 100,
        speed: 250 + i * 2,
        throttle: 95,
        brake: 0,
        gear: 7,
        rpm: 11500,
        drs: 1,
        sector: (i % 3) + 1,
        x: 200 + i * 5,
        y: 300 + i * 4,
      })),
    };

    it('renders TrackMapCanvas and TelemetryCanvas and synchronizes crosshair inspection', () => {
      const onInspectPoint = vi.fn();
      render(
        <ThemeProvider>
          <TrackMapCanvas
            activeCircuit={SAMPLE_CIRCUIT}
            multiPoints={{ VER: sampleHistory.VER[10] }}
            selectedDrivers={['VER']}
            primaryDriver="VER"
            ghostDelta={-0.142}
            sector={2}
            drs={true}
            inspectedPoint={sampleHistory.VER[5]}
          />
          <TelemetryCanvas
            multiHistory={sampleHistory}
            selectedDrivers={['VER']}
            primaryDriver="VER"
            onInspectPoint={onInspectPoint}
          />
        </ThemeProvider>
      );

      expect(screen.getByText('SECTOR 2')).toBeTruthy();
      expect(screen.getByText('DEPLOYED')).toBeTruthy();

      const oscCanvas = document.querySelector('.telemetry-canvas');
      fireEvent.mouseMove(oscCanvas, { clientX: 300, clientY: 120 });
      expect(onInspectPoint).toHaveBeenCalled();

      fireEvent.mouseLeave(oscCanvas);
      expect(onInspectPoint).toHaveBeenLastCalledWith(null);
    });

    it('respects prefers-reduced-motion by disabling continuous rAF loop and glow effects', () => {
      mockReducedMotion = true;
      const rafSpy = vi.spyOn(window, 'requestAnimationFrame');

      render(
        <ThemeProvider>
          <TrackMapCanvas
            activeCircuit={SAMPLE_CIRCUIT}
            multiPoints={{ VER: sampleHistory.VER[5] }}
            selectedDrivers={['VER']}
            primaryDriver="VER"
            ghostDelta={-0.08}
            sector={1}
            drs={false}
            inspectedPoint={null}
          />
        </ThemeProvider>
      );

      // Under reducedMotion, TrackMapCanvas renders synchronously without scheduling continuous rAF
      expect(rafSpy).not.toHaveBeenCalled();
      expect(mockCtx.createRadialGradient).not.toHaveBeenCalled();
    });
  });

  describe('PitWallHUD & StemPhysicsPanel Components', () => {
    const samplePoint = {
      speed: 318,
      live_speed_ms: 88.3,
      eta_seconds: 42.4,
      distance: 3250,
      rpm: 12100,
      gear: 8,
      throttle: 100,
      brake: 0,
      drs: 1,
      ers_soc: 84.5,
      ers_harvest: 0.0,
      tyre_compound: 'SOFT',
      tyre_wear: 11.2,
      tyre_temp_fl: 96.4,
      tyre_temp_fr: 97.1,
      tyre_temp_rl: 98.2,
      tyre_temp_rr: 98.8,
      delta_to_ghost: -0.185,
      sector: 2,
    };

    it('renders PitWallHUD with SVG sector dots (zero Unicode bullets) and rival comparison deltas', () => {
      const { container } = render(
        <PitWallHUD
          currentPoint={samplePoint}
          primaryDriver="VER"
          selectedDrivers={['VER', 'NOR']}
          multiPoints={{
            VER: samplePoint,
            NOR: { ...samplePoint, speed: 311, gear: 8, delta_to_ghost: 0.05 },
          }}
        />
      );

      expect(screen.getByText('318')).toBeTruthy();
      expect(screen.getByText('MULTI-CAR DELTA VS VER')).toBeTruthy();
      expect(screen.getByText('+7 km/h')).toBeTruthy();
      expect(container.textContent).not.toContain('●');
      expect(container.querySelectorAll('.s-status__dot').length).toBe(1);
    });

    it('switches StemPhysicsPanel tabs and updates live engineering calculations', () => {
      render(<StemPhysicsPanel currentPoint={samplePoint} />);

      expect(screen.getByText(/VERTICAL DOWNFORCE/i)).toBeTruthy();

      fireEvent.click(screen.getByRole('tab', { name: /Regenerative MGU-K/i }));
      expect(screen.getByText(/HARVEST POWER/i)).toBeTruthy();

      fireEvent.click(screen.getByRole('tab', { name: /Friction Ellipse/i }));
      expect(screen.getByText(/TOTAL G-FORCE/i)).toBeTruthy();
    });
  });

  describe('Dashboard Page & Keyboard Shortcut Isolation', () => {
    it('renders full Dashboard, handles playback & lap controls, and ignores keyboard shortcuts when typing in inputs', async () => {
      render(
        <ThemeProvider>
          <Dashboard />
        </ThemeProvider>
      );

      // Wait for initial async fetch effects to settle
      await screen.findByText('APEX PITWALL');

      // Play / Pause button
      const playPauseBtn = document.getElementById('playback-toggle-btn');
      expect(playPauseBtn).toBeTruthy();
      expect(playPauseBtn.textContent).toContain('PAUSE REPLAY');

      // Space key on window toggles playback
      fireEvent.keyDown(window, { code: 'Space' });
      expect(playPauseBtn.textContent).toContain('RESUME STREAM');

      // Open CUSTOM GP input and verify Space inside input does NOT toggle playback
      const customBtn = screen.getByRole('button', { name: /CUSTOM GP/i });
      fireEvent.click(customBtn);
      const roundInput = screen.getByRole('spinbutton');
      fireEvent.keyDown(roundInput, { code: 'Space' });
      expect(playPauseBtn.textContent).toContain('RESUME STREAM');
    });
  });
});
