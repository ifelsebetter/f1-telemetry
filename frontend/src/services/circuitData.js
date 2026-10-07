/**
 * Driver profiles and circuit metadata helpers.
 *
 * Real track geometries are fetched exclusively from FastF1 via the backend API.
 * No mock, synthetic, or fabricated track waypoints are stored here.
 */

export const DRIVER_PROFILES = {
  VER: { code: 'VER', name: 'Max Verstappen', number: 1, team: 'Red Bull Racing', color: '#3671c6', secondaryColor: '#cc1e4a', flag: 'NLD' },
  NOR: { code: 'NOR', name: 'Lando Norris', number: 4, team: 'McLaren', color: '#ff8000', secondaryColor: '#47c7fc', flag: 'GBR' },
  LEC: { code: 'LEC', name: 'Charles Leclerc', number: 16, team: 'Ferrari', color: '#e8002d', secondaryColor: '#ffffff', flag: 'MCO' },
  HAM: { code: 'HAM', name: 'Lewis Hamilton', number: 44, team: 'Mercedes', color: '#27f4d2', secondaryColor: '#c0c0c0', flag: 'GBR' },
  PIA: { code: 'PIA', name: 'Oscar Piastri', number: 81, team: 'McLaren', color: '#ff9e3b', secondaryColor: '#ff8000', flag: 'AUS' },
  SAI: { code: 'SAI', name: 'Carlos Sainz', number: 55, team: 'Ferrari', color: '#ff4d6d', secondaryColor: '#e8002d', flag: 'ESP' },
  PER: { code: 'PER', name: 'Sergio Perez', number: 11, team: 'Red Bull Racing', color: '#1e40af', secondaryColor: '#3671c6', flag: 'MEX' },
  RUS: { code: 'RUS', name: 'George Russell', number: 63, team: 'Mercedes', color: '#67e8f9', secondaryColor: '#27f4d2', flag: 'GBR' },
  ALO: { code: 'ALO', name: 'Fernando Alonso', number: 14, team: 'Aston Martin', color: '#229971', secondaryColor: '#cedc00', flag: 'ESP' },
  STR: { code: 'STR', name: 'Lance Stroll', number: 18, team: 'Aston Martin', color: '#34d399', secondaryColor: '#229971', flag: 'CAN' },
  GAS: { code: 'GAS', name: 'Pierre Gasly', number: 10, team: 'Alpine', color: '#0093cc', secondaryColor: '#ff87bc', flag: 'FRA' },
  TSU: { code: 'TSU', name: 'Yuki Tsunoda', number: 22, team: 'RB', color: '#6692ff', secondaryColor: '#ffffff', flag: 'JPN' },
  ALB: { code: 'ALB', name: 'Alexander Albon', number: 23, team: 'Williams', color: '#64c4ff', secondaryColor: '#005aff', flag: 'THA' },
  OCO: { code: 'OCO', name: 'Esteban Ocon', number: 31, team: 'Alpine', color: '#ff87bc', secondaryColor: '#0093cc', flag: 'FRA' },
  HUL: { code: 'HUL', name: 'Nico Hülkenberg', number: 27, team: 'Haas', color: '#b6babd', secondaryColor: '#e8002d', flag: 'DEU' },
  BOT: { code: 'BOT', name: 'Valtteri Bottas', number: 77, team: 'Kick Sauber', color: '#52e252', secondaryColor: '#000000', flag: 'FIN' },
  RIC: { code: 'RIC', name: 'Daniel Ricciardo', number: 3, team: 'RB', color: '#818cf8', secondaryColor: '#6692ff', flag: 'AUS' },
  ZHO: { code: 'ZHO', name: 'Zhou Guanyu', number: 24, team: 'Kick Sauber', color: '#86efac', secondaryColor: '#52e252', flag: 'CHN' },
  MAG: { code: 'MAG', name: 'Kevin Magnussen', number: 20, team: 'Haas', color: '#cbd5e1', secondaryColor: '#e8002d', flag: 'DNK' },
  SAR: { code: 'SAR', name: 'Logan Sargeant', number: 2, team: 'Williams', color: '#93c5fd', secondaryColor: '#64c4ff', flag: 'USA' },
};

export function getCircuitPreset(circuitId) {
  const slug = (circuitId || 'bahrain').toLowerCase().replace(/[\s-]/g, '_');
  return {
    id: slug,
    name: `${slug.charAt(0).toUpperCase() + slug.slice(1)} Grand Prix`,
    location: '',
    country: '',
    waypoints: [],
    turns: [],
  };
}

export function getDriverProfile(driverCode) {
  const code = (driverCode || 'VER').toUpperCase().trim();
  return (
    DRIVER_PROFILES[code] || {
      code,
      name: `Driver ${code}`,
      number: 99,
      team: 'F1 Competitor',
      color: '#38bdf8',
      secondaryColor: '#ffffff',
      flag: 'FIA',
    }
  );
}
