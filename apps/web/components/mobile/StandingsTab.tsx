'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CALENDAR, NATIONS } from '@kickstock/constants';
import { buildGroupStandingsUI } from '@kickstock/game-engine';
import { useGameStore } from '@/stores/gameStore';
import NationDetailOverlay from '@/components/shared/NationDetailOverlay';
import MatchDetailOverlay from '@/components/shared/MatchDetailOverlay';
import StandingsCard from '@/components/shared/StandingsCard';
import type { StoredMatchResult } from '@kickstock/types';
import styles from './StandingsTab.module.css';

const gN = (id: string) => NATIONS.find(n => n.id === id);

type KoPhase = 'R32' | 'R16' | 'QF' | 'SF' | 'Final' | '3rd';
type KoLabelKey = 'r32' | 'r16' | 'quarterFinals' | 'semiFinals' | 'final' | 'thirdPlace';

const koLabelKeys: Record<KoPhase, KoLabelKey> = {
  R32: 'r32', R16: 'r16', QF: 'quarterFinals', SF: 'semiFinals', Final: 'final', '3rd': 'thirdPlace',
};

export default function StandingsTab() {
  const t = useTranslations('standings');
  const [nationId,    setNationId]    = useState<string | null>(null);
  const [matchDetail, setMatchDetail] = useState<{ result: StoredMatchResult; dayLabel: string } | null>(null);

  const prices       = useGameStore(s => s.prices);
  const eliminated   = useGameStore(s => s.eliminated);
  const matchResults = useGameStore(s => s.matchResults);
  const dayIndex     = useGameStore(s => s.dayIndex);
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

  const koPhases: KoPhase[] = ['R32', 'R16', 'QF', 'SF', 'Final', '3rd'];

  return (
    <>
      <div>
        {/* KO Results */}
        {isKO && (
          <div className={styles.koSection}>
            {champion && (
              <div className={styles.champion}>
                <div className={styles.championFlag}>{gN(champion)?.flag}</div>
                <button className={styles.championName} onClick={() => setNationId(champion)}>
                  {t('champion', { nation: gN(champion)?.name?.toUpperCase() ?? '' })}
                </button>
              </div>
            )}
            {koPhases.map(phase => {
              const res = koResults[phase];
              if (!res?.length) return null;
              return (
                <div key={phase} className={styles.koPhase}>
                  <div className={styles.phaseLabel}>{t(koLabelKeys[phase])}</div>
                  {res.map((r, i) => {
                    const nA = gN(r.a), nB = gN(r.b);
                    const dayEntry = Object.entries(matchResults).find(([, results]) =>
                      results.some(x => x.a === r.a && x.b === r.b)
                    );
                    const dayLabel = dayEntry ? CALENDAR[Number(dayEntry[0])]?.label ?? '' : '';
                    return (
                      <div key={i} className={styles.koMatch}>
                        <div className={`${styles.koRow} ${r.res === 'A' ? styles.koWin : styles.koLose}`}>
                          <button className={styles.koTeamBtn} onClick={() => setNationId(r.a)}>
                            {nA?.flag} {nA?.name?.toUpperCase()}
                          </button>
                          <button className={styles.koScoreBtn} onClick={() => setMatchDetail({ result: r, dayLabel })}>
                            {r.scoreA}
                          </button>
                        </div>
                        <div className={`${styles.koRow} ${r.res === 'B' ? styles.koWin : styles.koLose}`}>
                          <button className={styles.koTeamBtn} onClick={() => setNationId(r.b)}>
                            {nB?.flag} {nB?.name?.toUpperCase()}
                          </button>
                          <button className={styles.koScoreBtn} onClick={() => setMatchDetail({ result: r, dayLabel })}>
                            {r.scoreB}
                          </button>
                        </div>
                        {r.penWinner && <div className={styles.koMeta}>Pens {r.penA}–{r.penB}</div>}
                        {r.etRes && !r.penWinner && <div className={`${styles.koMeta} ${styles.koMetaET}`}>{t('aet')}</div>}
                        {r.isUpset && <div className={`${styles.koMeta} ${styles.koMetaUpset}`}>{t('upset')}</div>}
                      </div>
                    );
                  })}
                </div>
              );
            })}
            <hr className={styles.divider} />
          </div>
        )}

        {/* Group Standings */}
        <div className={styles.groupsHeader}>{t('groupStandings')}</div>
        {Object.entries(standings).map(([g, teams]) => {
          const groupDaysPlayed = Object.keys(matchResults).filter(di =>
            CALENDAR[Number(di)]?.phase === 'Groups'
          ).length;
          const matchday = t('matchday', { n: Math.min(groupDaysPlayed, 3), total: 3 });
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
