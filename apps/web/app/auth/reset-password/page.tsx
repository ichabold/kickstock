'use client';

/**
 * /auth/reset-password
 * Shown after the user clicks the password-reset link in their email.
 * The /auth/confirm route has already verified the OTP and established
 * a session — so supabase.auth.updateUser() will work here.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import styles from './page.module.css';

export default function ResetPasswordPage() {
  const router  = useRouter();
  const t       = useTranslations('auth.resetPassword');
  const [password,  setPassword]  = useState('');
  const [password2, setPassword2] = useState('');
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');
  const [done,      setDone]      = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) { setError(t('tooShort')); return; }
    if (password !== password2) { setError(t('mismatch')); return; }

    setLoading(true);
    setError('');

    const sb = createClient();
    const { error: err } = await sb.auth.updateUser({ password });

    if (err) {
      setError(t('updateError'));
      setLoading(false);
      return;
    }

    setDone(true);
    setTimeout(() => router.replace('/'), 2000);
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        {done ? (
          <>
            <div className={styles.icon}>✓</div>
            <div className={styles.title}>{t('successTitle')}</div>
            <div className={styles.sub}>{t('successSubtitle')}</div>
          </>
        ) : (
          <>
            <div className={styles.title}>{t('title')}</div>
            <div className={styles.sub}>{t('subtitle')}</div>

            <form onSubmit={handleSubmit} className={styles.form}>
              <div>
                <label className={styles.label}>{t('newPasswordLabel')}</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder={t('newPasswordPlaceholder')}
                  autoFocus
                  className={styles.input}
                />
              </div>
              <div>
                <label className={styles.label}>{t('confirmLabel')}</label>
                <input
                  type="password"
                  value={password2}
                  onChange={e => setPassword2(e.target.value)}
                  placeholder={t('confirmPlaceholder')}
                  className={styles.input}
                />
              </div>

              {error && <div className={styles.errorBox}>{error}</div>}

              <button
                type="submit"
                disabled={loading || password.length < 8 || password !== password2}
                className={styles.btn}
              >
                {loading ? t('savingButton') : t('confirmButton')}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
