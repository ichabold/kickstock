'use client';

/**
 * onlineGameStore — Multiplayer version backed by Supabase.
 *
 * State is authoritative on the server (shared game_state row).
 * Push model: Supabase Realtime notifies of game_state changes;
 * we refetch only when the server signals something changed.
 * A 30s fallback poll keeps clients in sync if the websocket drops.
 */

import { create } from 'zustand';
import { getDeviceId } from '@/lib/device';
import { fetchGameState, apiTrade, apiAdvanceDay } from '@/lib/api';
import { pctOf, fmt } from '@kickstock/game-engine';
import { NATIONS, CALENDAR } from '@kickstock/constants';
import { buildMatchesForDay } from '@kickstock/game-engine';
import { createClient } from '@/lib/supabase/client';
import type { GameState, TradeMode, StoredMatchResult, Match } from '@kickstock/types';
import type { RealtimeChannel } from '@supabase/supabase-js';

export { fmt, pctOf };

interface AdvanceDayResult {
  results: StoredMatchResult[];
  flash:   Record<string, 'fu' | 'fd'>;
}

interface GameStore extends GameState {
  loading:          boolean;
  syncing:          boolean;
  error:            string | null;
  fetchState:       () => Promise<void>;
  startSync:        () => void;
  stopSync:         () => void;
  trade:            (mode: TradeMode, nationId: string, quantity: number) => Promise<string | null>;
  advanceDay:       () => Promise<AdvanceDayResult | null>;
  resetGame:        () => void;
  _pollId:          ReturnType<typeof setInterval> | null;
  _realtimeChannel: RealtimeChannel | null;
}

function emptyState(): GameState {
  return {
    cash:         10_000,
    portfolio:    {},
    avgCost:      {},
    prices:       Object.fromEntries(NATIONS.map(n => [n.id, n.p])),
    priceHistory: Object.fromEntries(NATIONS.map(n => [n.id, [n.p]])),
    dayIndex:     0,
    eliminated:   [],
    champion:     null,
    matchResults: {},
    r32Pool:      [],
    r16Pool:      [],
    qfPool:       [],
    sfPool:       [],
    finalPool:    [],
    thirdPool:    [],
    txLog:        [],
    bestScore:    null,
  };
}

export const useOnlineGameStore = create<GameStore>((set, get) => ({
  ...emptyState(),
  loading:          true,
  syncing:          false,
  error:            null,
  _pollId:          null,
  _realtimeChannel: null,

  fetchState: async () => {
    const deviceId = getDeviceId();
    try {
      const data = await fetchGameState(deviceId);
      const enriched = data.txLog.map(t => {
        const n = NATIONS.find(x => x.id === t.name) ?? null;
        return { ...t, flag: n?.flag ?? '', name: n?.name ?? t.name };
      });
      set({
        cash: data.cash, portfolio: data.portfolio, avgCost: data.avgCost,
        prices: data.prices, priceHistory: data.priceHistory,
        dayIndex: data.dayIndex, eliminated: data.eliminated, champion: data.champion,
        matchResults: data.matchResults, r32Pool: data.r32Pool, r16Pool: data.r16Pool,
        qfPool: data.qfPool, sfPool: data.sfPool, finalPool: data.finalPool,
        thirdPool: data.thirdPool, txLog: enriched, bestScore: data.bestScore,
        loading: false, syncing: false, error: null,
      });
    } catch (err) {
      if (String(err).includes('NOT_MODIFIED')) {
        // 304: state unchanged — just clear loading flags
        set({ loading: false, syncing: false });
        return;
      }
      set({ loading: false, syncing: false, error: String(err) });
    }
  },

  startSync: () => {
    if (get()._pollId || get()._realtimeChannel) return;

    // Initial fetch on mount
    get().fetchState();

    // Supabase Realtime: receive a push whenever game_state changes (day advances)
    // → refetch immediately instead of waiting for the next poll cycle.
    // Prerequisite: enable Realtime on the game_state table in Supabase dashboard
    // (Table Editor → game_state → Realtime toggle ON).
    const supabase = createClient();
    const channel = supabase
      .channel('ks_game_state')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'game_state' },
        () => {
          if (get().syncing) return;
          set({ syncing: true });
          get().fetchState();
        },
      )
      .subscribe();

    // 30s fallback poll — keeps clients in sync if the websocket is unavailable
    const id = setInterval(() => {
      if (get().syncing) return;
      set({ syncing: true });
      get().fetchState();
    }, 30_000);

    set({ _pollId: id, _realtimeChannel: channel });
  },

  stopSync: () => {
    const { _pollId, _realtimeChannel } = get();
    if (_pollId) clearInterval(_pollId);
    if (_realtimeChannel) {
      createClient().removeChannel(_realtimeChannel);
    }
    set({ _pollId: null, _realtimeChannel: null });
  },

  trade: async (mode, nationId, quantity) => {
    const deviceId = getDeviceId();
    const s = get();
    const n = NATIONS.find(x => x.id === nationId);
    if (!n) return 'Nation introuvable';
    const price = s.prices[nationId] ?? n.p;
    const held  = s.portfolio[nationId] ?? 0;
    const isKO  = !!s.dayIndex && s.dayIndex > 16;
    if (mode === 'buy') {
      if (s.eliminated.includes(nationId)) return 'Nation éliminée 💀';
      if (price * quantity > s.cash) return 'Fonds insuffisants';
    } else {
      if (held < quantity) return 'Actions insuffisantes';
    }
    const result = await apiTrade(deviceId, mode, nationId, quantity);
    if (result.error) return result.error;
    if (mode === 'buy') {
      const prevAvg = s.avgCost[nationId] ?? n.p;
      const newAvg  = held === 0 ? price : (held * prevAvg + quantity * price) / (held + quantity);
      set({
        cash: result.newCash ?? Math.round((s.cash - price * quantity) * 10) / 10,
        portfolio: { ...s.portfolio, [nationId]: held + quantity },
        avgCost:   { ...s.avgCost, [nationId]: Math.round(newAvg * 10) / 10 },
        txLog:     [{ dir: 'buy' as const, flag: n.flag, name: n.name, qty: quantity, price, day: s.dayIndex }, ...s.txLog].slice(0, 100),
      });
    } else {
      const gross = price * quantity;
      const fee   = isKO ? gross * 0.10 : gross * 0.05;
      const net   = gross - (s.eliminated.includes(nationId) ? 0 : fee);
      const newHeld = Math.max(0, held - quantity);
      const newPort = { ...s.portfolio };
      const newAvgs = { ...s.avgCost };
      if (newHeld > 0) newPort[nationId] = newHeld;
      else { delete newPort[nationId]; delete newAvgs[nationId]; }
      set({
        cash:      result.newCash ?? Math.round((s.cash + net) * 10) / 10,
        portfolio: newPort, avgCost: newAvgs,
        txLog:     [{ dir: 'sell' as const, flag: n.flag, name: n.name, qty: quantity, price, day: s.dayIndex }, ...s.txLog].slice(0, 100),
      });
    }
    return null;
  },

  advanceDay: async () => {
    const deviceId = getDeviceId();
    const s = get();
    const response = await apiAdvanceDay(deviceId, s.dayIndex);
    if (!response || !response.results) return null;
    set({
      prices: response.prices, eliminated: response.eliminated,
      r32Pool: response.r32Pool, r16Pool: response.r16Pool,
      qfPool: response.qfPool, sfPool: response.sfPool,
      finalPool: response.finalPool, thirdPool: response.thirdPool,
      champion: response.champion, dayIndex: response.newDayIndex,
      cash: response.newCash ?? s.cash,
      matchResults: { ...s.matchResults, [s.dayIndex]: response.results },
    });
    const totalVal = (response.newCash ?? s.cash) +
      Object.entries(s.portfolio).reduce((acc, [id, q]) => acc + q * (response.prices[id] ?? s.prices[id] ?? 0), 0);
    if (s.bestScore === null || totalVal > s.bestScore) set({ bestScore: totalVal });
    return { results: response.results, flash: response.flash };
  },

  resetGame: () => { set({ ...emptyState(), loading: false }); },
}));

export function buildMatchesForCurrentDay(state: GameState): Match[] {
  const day = CALENDAR[state.dayIndex];
  if (!day) return [];
  if (day.matches.length > 0) {
    return day.matches.filter(m => {
      const nA = NATIONS.find(n => n.id === m.a);
      const nB = NATIONS.find(n => n.id === m.b);
      return nA && nB && !state.eliminated.includes(m.a) && !state.eliminated.includes(m.b);
    });
  }
  if (day.dynamic) {
    return buildMatchesForDay(day.dynamic, state).filter(m =>
      NATIONS.find(n => n.id === m.a) && NATIONS.find(n => n.id === m.b)
    );
  }
  return [];
}
