/**
 * REST API client for the F1 Telemetry backend.
 *
 * All functions return parsed JSON or throw on error.
 * The base URL is resolved through Vite's proxy in development
 * and can be overridden via VITE_API_URL for production builds.
 */

const API_BASE = import.meta.env.VITE_API_URL || '';

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request(path, options = {}) {
  const url = `${API_BASE}${path}`;

  // Merge headers safely — caller cannot override Accept
  const { headers: extraHeaders, ...restOptions } = options;
  const headers = {
    ...extraHeaders,
    'Accept': 'application/json',
  };

  let response;
  try {
    response = await fetch(url, { headers, ...restOptions });
  } catch (err) {
    throw new ApiError(
      err instanceof TypeError ? 'Network error — unable to reach the server' : 'Request failed',
      0
    );
  }

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      if (body && typeof body.detail === 'string') {
        // Limit error detail length to prevent DOM bloat from malicious responses
        detail = body.detail.slice(0, 500);
      }
    } catch {
      // Response body is not JSON — use status code
    }
    throw new ApiError(detail, response.status);
  }

  return response.json();
}

/** Fetch the list of available telemetry sessions. */
export async function fetchSessions() {
  return request('/api/v1/sessions');
}

/**
 * Fetch telemetry data for a specific session.
 * @param {{ year: number, round: number, session_type: string, lap?: number, fields?: string }} params
 */
export async function fetchTelemetry(params) {
  const searchParams = new URLSearchParams();
  searchParams.set('year', String(Number(params.year)));
  searchParams.set('round', String(Number(params.round)));

  // Sanitise session_type to alphanumeric only
  const sessionType = String(params.session_type).replace(/[^A-Za-z0-9]/g, '');
  if (!sessionType) {
    throw new ApiError('Invalid session type', 400);
  }
  searchParams.set('session_type', sessionType);

  if (params.lap != null) {
    const lap = Number(params.lap);
    if (Number.isFinite(lap) && lap >= 1) {
      searchParams.set('lap', String(Math.floor(lap)));
    }
  }
  if (typeof params.fields === 'string' && params.fields.length > 0) {
    // Sanitise field names to alphanumeric + commas only
    const sanitised = params.fields.replace(/[^A-Za-z0-9,_]/g, '');
    if (sanitised) {
      searchParams.set('fields', sanitised);
    }
  }

  return request(`/api/v1/telemetry?${searchParams.toString()}`);
}

/** Fetch telemetry field metadata (names, units, descriptions). */
export async function fetchMetadata() {
  return request('/api/v1/telemetry/metadata');
}

/** Simple health check. */
export async function checkHealth() {
  return request('/health');
}

/**
 * Build the WebSocket URL for telemetry streaming.
 * In development the Vite proxy handles the /ws path.
 */
export function getWebSocketUrl() {
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/telemetry`;
}
