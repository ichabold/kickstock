'use client';

import { useMemo, useState } from 'react';
import { CALENDAR, NATIONS } from '@kickstock/constants';
import { buildGroupStandingsUI } from '@kickstock/game-engine';
import { useGameStore } from '@/stores/gameStore';
import NationDetailOverlay from '@/components/shared/NationDetailOverlay';
import MatchDetailOverlay from '@/components/shared/MatchDetailOverlay';
import StandingsCard from '@/components/shared/StandingsCard';
import type { StoredMatchResult } from '@kickstock/types';
import styles from './ScheduleTab.module.css';

const gN = (id: string) => NATIONS.find(n => n.id === id);

export default function StandingsTab() {
  const [nationId,    setNationId]    = useState<string | null>(null);
  const [matchDetail, setMatchDetail] = useState<{ result: StoredMatchResult; dayLabel: string } | null>(null);

  const prices       = useGameStore(s => s.prices);
  const eliminated   = useGameStore(s => s.eliminated);
  const matchResults = useGameStore(s => s.matchResults);
  const dayIndex     = useGameStore(s => s.dayIndex);
  const r32Pool      = useGameStore(s => s.r32Pool);
  const champion     = useGameStore(s => s.champion);

  const standings = useMemo(
    () => buildGroupStandingsUI(matchResults, prices, eliminated),
    [matchResults, prices, eliminated],
  );

  const koResults = useMemo(() => {
    const r: Record<string, StoredMatchResult[]> = { R32: [], R16: [], QF: [], SF: [], Final: [], '3rd': [] };
    for (const [diStr, res] of Object.entries(matchResults)) {
      const day = CALENDAR[Number(diStr)];
      if (!day?.isKO) continue;
      const key = day.phase as string;
      if (r[key]) r[key] = [...r[key], ...res];
    }
    return r;
  }, [matchResults]);

  const isKO = dayIndex > 17 || !CALENDAR[dayIndex] || CALENDAR[dayIndex]?.phase !== 'Groups';

  const koPhases = ['R32', 'R16', 'QF', 'SF', 'Final', '3rd'] as const;
  const koLabels: Record<string, string> = {
    R32: 'HUITIÈMES · R32', R16: 'SEIZIÈMES · R16', QF: 'QUARTS DE FINALE',
    SF: 'DEMI-FINALES', Final: '🏆 FINALE', '3rd': '🥉 PETITE FINALE',
  };

  return (
    <>
      <div>
        {/* KO Results */}
        {isKO && (
          <div style={{ marginBottom: 12 }}>
            {champion && (
              <div style={{
                background: 'rgba(255,219,0,0.06)', border: '1px solid var(--gold-dk)',
                borderRadius: 9, padding: '12px 14px', marginBottom: 8, textAlign: 'center',
              }}>
                <div style={{ fontSize: 32 }}>{gN(champion)?.flag}</div>
                <button
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  onClick={() => setNationId(champion)}
                >
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, letterSpacing: 3, color: 'var(--gold)' }}>
                    {gN(champion)?.name?.toUpperCase()} — CHAMPION 🏆
                  </div>
                </button>
              </div>
            )}
            {koPhases.map(phase => {
              const res = koResults[phase];
              if (!res?.length) return null;
              return (
                <div key={phase} style={{ marginBottom: 10 }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, letterSpacing: 2, color: 'var(--gold)', marginBottom: 4 }}>
                    {koLabels[phase]}
                  </div>
                  {res.map((r, i) => {
                    const nA = gN(r.a), nB = gN(r.b);
                    const dayEntry = Object.entries(matchResults).find(([, results]) =>
                      results.some(x => x.a === r.a && x.b === r.b)
                    );
                    const dayLabel = dayEntry ? CALENDAR[Number(dayEntry[0])]?.label ?? '' : '';
                    return (
                      <div key={i} style={{
                        background: 'var(--s2)', border: '1px solid var(--border)',
                        borderRadius: 7, padding: 10, marginBottom: 4,
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700,
                          color: r.res === 'A' ? 'var(--gold)' : 'var(--muted)' }}>
                          <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'inherit', font: 'inherit', fontWeight: 700 }}
                            onClick={() => setNationId(r.a)}>
                            {nA?.flag} {nA?.name?.toUpperCase()}
                          </button>
                          <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'inherit', fontFamily: 'var(--font-mono)', fontWeight: 700 }}
                            onClick={() => setMatchDetail({ result: r, dayLabel })}>
                            {r.scoreA}
                          </button>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700,
                          color: r.res === 'B' ? 'var(--gold)' : 'var(--muted)' }}>
                          <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'inherit', font: 'inherit', fontWeight: 700 }}
                            onClick={() => setNationId(r.b)}>
                            {nB?.flag} {nB?.name?.toUpperCase()}
                          </button>
                          <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'inherit', fontFamily: 'var(--font-mono)', fontWeight: 700 }}
                            onClick={() => setMatchDetail({ result: r, dayLabel })}>
                            {r.scoreB}
                          </button>
                        </div>
                        {r.penWinner && <div style={{ fontSize: 8, color: 'var(--muted)', marginTop: 2 }}>Pens {r.penA}–{r.penB}</div>}
                        {r.etRes && !r.penWinner && <div style={{ fontSize: 8, color: 'var(--gold)', marginTop: 2 }}>⚡ AET</div>}
                        {r.isUpset && <div style={{ fontSize: 8, color: 'var(--upset)', marginTop: 2 }}>🚀 UPSET!</div>}
                      </div>
                    );
                  })}
                </div>
              );
            })}
            <div style={{ borderTop: '1px solid var(--border)', margin: '12px 0' }} />
          </div>
        )}

        {/* Group Standings */}
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, letterSpacing: 2, color: 'var(--dim)', marginBottom: 8 }}>
          GROUP STANDINGS
        </div>
        {Object.entries(standings).map(([g, teams]) => {
          const groupDaysPlayed = Object.keys(matchResults).filter(di =>
            CALENDAR[Number(di)]?.phase === 'Groups'
          ).length;
          const matchday = `MD ${Math.min(groupDaysPlayed, 3)} of 3`;
          return (
            <StandingsCard
              key={g}
              group={g}
              teams={teams}
              matchday={matchday}
              onNationClick={id => setNationId(id)}
            />
          );
        })}
      </div>

      {matchDetail && (
        <MatchDetailOverlay
          result={matchDetail.result}
          dayLabel={matchDetail.dayLabel}
          onClose={() => setMatchDetail(null)}
          onNationClick={id => { setMatchDetail(null); setNationId(id); }}
        />
      )}

      {nationId && (
        <NationDetailOverlay
          nationId={nationId}
          onClose={() => setNationId(null)}
        />
      )}
    </>
  );
}
