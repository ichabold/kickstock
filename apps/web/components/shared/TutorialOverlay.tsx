'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

const STEP_ICONS = ['⚽', '📈', '💰', '🔒'];

export default function TutorialOverlay({ onClose }: { onClose: () => void }) {
  const t = useTranslations('tutorial');
  const [step, setStep] = useState(0);

  const steps = [
    { title: t('step1Title'), text: t('step1Text'), icon: STEP_ICONS[0] },
    { title: t('step2Title'), text: t('step2Text'), icon: STEP_ICONS[1] },
    { title: t('step3Title'), text: t('step3Text'), icon: STEP_ICONS[2] },
    { title: t('step4Title'), text: t('step4Text'), icon: STEP_ICONS[3] },
  ];

  const s = steps[step];
  const isLast = step === steps.length - 1;

  return (
    <div style={ts.overlay} onClick={onClose}>
      <div style={ts.box} onClick={e => e.stopPropagation()}>
        <button style={ts.close} onClick={onClose}>✕</button>
        <div style={ts.icon}>{s.icon}</div>
        <div style={ts.title}>{s.title}</div>
        <div style={ts.text}>{s.text}</div>
        <div style={ts.dots}>
          {steps.map((_, i) => (
            <div key={i} style={{ ...ts.dot, ...(i === step ? ts.dotOn : {}) }} />
          ))}
        </div>
        <div style={ts.btns}>
          {step > 0 && (
            <button style={{ ...ts.btn, ...ts.btnSec }} onClick={() => setStep(n => n - 1)}>
              {t('back')}
            </button>
          )}
          {!isLast ? (
            <button style={{ ...ts.btn, ...ts.btnPri }} onClick={() => setStep(n => n + 1)}>
              {t('next')}
            </button>
          ) : (
            <button style={{ ...ts.btn, ...ts.btnPri }} onClick={onClose}>
              {t('start')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const ts: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.88)',
    zIndex: 450,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px 16px',
  },
  box: {
    background: 'var(--s1)',
    border: '1px solid var(--border-hi)',
    borderRadius: 16,
    padding: '32px 28px',
    width: '100%',
    maxWidth: 440,
    position: 'relative',
    textAlign: 'center',
  },
  close: {
    position: 'absolute',
    top: 12,
    right: 14,
    background: 'none',
    border: 'none',
    color: 'var(--muted)',
    fontSize: 16,
    cursor: 'pointer',
  },
  icon: { fontSize: 48, marginBottom: 12 },
  title: {
    fontFamily: 'var(--font-display)',
    fontSize: 22,
    letterSpacing: 2,
    color: 'var(--gold)',
    marginBottom: 10,
  },
  text: {
    fontSize: 13,
    color: 'var(--muted)',
    lineHeight: 1.6,
    marginBottom: 20,
  },
  dots: { display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 20 },
  dot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: 'var(--border-hi)',
    transition: 'all .2s',
  },
  dotOn: { width: 18, borderRadius: 3, background: 'var(--gold)' },
  btns: { display: 'flex', gap: 8, justifyContent: 'center' },
  btn: {
    padding: '10px 24px',
    borderRadius: 8,
    fontWeight: 700,
    fontSize: 12,
    letterSpacing: 1,
    cursor: 'pointer',
    fontFamily: 'var(--font-body)',
  },
  btnPri: { background: 'var(--gold)', color: '#000', border: 'none' },
  btnSec: { background: 'none', border: '1px solid var(--border-hi)', color: 'var(--muted)' },
};
