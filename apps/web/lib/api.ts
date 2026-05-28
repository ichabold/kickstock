/**
 * Client-side API helpers — all calls go through Next.js API routes.
 * Device identification via X-Device-ID header (anonymous play).
 */
import type { StoredMatchResult } from '@kickstock/types';

export interface GameStateResponse {
  // ── Shared game state ────────────────────────────────────────────────────────
  dayIndex:    number;
  phase:       string;
  champion:    string | null;
  eliminated:  string[];
  r32Pool:     string[];
  r16Pool:     string[];
  qfPool:      string[];
  sfPool:      string[];
  finalPool:   string[];
  thirdPool:   string[];
  // ── Prices ───────────────────────────────────────────────────────────────────
  prices:       Record<string, number>;
  priceHistory: Record<string, number[]>;
  // ── Match results (for Schedule + Standings) ─────────────────────────────────
  matchResults: Record<number, StoredMatchResult[]>;
  // ── Player portfolio ─────────────────────────────────────────────────────────
  cash:       number;
  portfolio:  Record<string, number>;  // nationId → qty
  avgCost:    Record<string, number>;
  txLog:      TxEntry[];
  bestScore:  number | null;
}

export interface TxEntry {
  dir:   'buy' | 'sell';
  flag:  string;
  name:  string;
  qty:   number;
  price: number;
  day:   number;
}

export interface AdvanceDayResponse {
  results:    StoredMatchResult[];
  flash:      Record<string, 'fu' | 'fd'>;
  newDayIndex: number;
  newPhase:   string;
  // Updated shared state (avoid a second poll)
  prices:     Record<string, number>;
  eliminated: string[];
  r32Pool:    string[];
  r16Pool:    string[];
  qfPool:     string[];
  sfPool:     string[];
  finalPool:  string[];
  thirdPool:  string[];
  champion:   string | null;
  // Updated player cash (after dividends)
  newCash:    number;
}

// ETag cache: path → last known ETag value
const _etagCache: Record<string, string> = {};

// ── Core fetch wrapper ────────────────────────────────────────────────────────
async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  deviceId: string,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Device-ID': deviceId,
    ...(options.headers as Record<string, string> ?? {}),
  };

  // Send cached ETag for GET requests to enable 304 Not Modified responses
  if (!options.method || options.method === 'GET') {
    const cached = _etagCache[path];
    if (cached) headers['If-None-Match'] = cached;
  }

  const res = await fetch(path, { ...options, headers });

  if (res.status === 304) {
    // Server confirmed nothing changed — caller should keep its current state
    throw new Error('NOT_MODIFIED');
  }

  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    throw new Error(`API ${path} failed (${res.status}): ${text}`);
  }

  // Cache the new ETag for the next request
  const newEtag = res.headers.get('ETag');
  if (newEtag) _etagCache[path] = newEtag;

  return res.json();
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function fetchGameState(deviceId: string): Promise<GameStateResponse> {
  return apiFetch<GameStateResponse>('/api/game/state', {}, deviceId);
}

export async function apiTrade(
  deviceId:  string,
  mode:      'buy' | 'sell',
  nationId:  string,
  quantity:  number,
): Promise<{ error: string | null; newCash?: number; newHeld?: number }> {
  return apiFetch(
    '/api/trade',
    { method: 'POST', body: JSON.stringify({ nationId, mode, quantity }) },
    deviceId,
  );
}

export async function apiAdvanceDay(
  deviceId:  string,
  dayIndex:  number,
): Promise<AdvanceDayResponse | null> {
  try {
    return await apiFetch<AdvanceDayResponse>(
      '/api/game/advance',
      { method: 'POST', body: JSON.stringify({ dayIndex }) },
      deviceId,
    );
  } catch (e) {
    console.error('[apiAdvanceDay]', e);
    return null;
  }
}
