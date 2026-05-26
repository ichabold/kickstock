'use client';

/**
 * gameStore — public entry point for all components.
 *
 * Default mode (NEXT_PUBLIC_OFFLINE_MODE=true or unset):
 *   → localGameStore: per-device state in localStorage, client-side simulation.
 *     Each player has a fully independent game. Best scores are synced to
 *     Supabase for the leaderboard when logged in.
 *
 * To switch to shared/multiplayer mode, set NEXT_PUBLIC_OFFLINE_MODE=false
 * and swap the re-export below to point at onlineGameStore instead.
 *
 * All components import from '@/stores/gameStore' — the mode is invisible to them.
 */

export {
  useLocalGameStore as useGameStore,
  buildMatchesForCurrentDay,
  fmt,
  pctOf,
} from './localGameStore';
