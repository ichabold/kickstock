/**
 * GET /auth/callback
 * Handles the OAuth redirect from Supabase (Google Sign-In).
 *
 * Flow:
 *  1. Exchange the `code` param for a Supabase session
 *  2. Read `ks_pending_device` cookie set by the Google button
 *  3. Call migrate_guest_to_user RPC if a device_id is present
 *  4. Detect first-time signup (needs username prompt)
 *  5. Redirect to / with query params for WelcomeModal
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createAdminClient } from '@/lib/supabase/admin';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adminRpc = (a: ReturnType<typeof createAdminClient>, fn: string, args: object) => (a as any).rpc(fn, args);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adminFrom = (a: ReturnType<typeof createAdminClient>, t: string) => (a as any).from(t);

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code  = searchParams.get('code');
  const error = searchParams.get('error');

  // OAuth error from Google/Supabase
  if (error || !code) {
    return NextResponse.redirect(`${origin}/?ks_auth_error=1`);
  }

  // Build Supabase client with cookie forwarding (required for SSR session)
  const response = NextResponse.redirect(`${origin}/`);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Exchange code for session
  const { data: { session }, error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeErr || !session) {
    return NextResponse.redirect(`${origin}/?ks_auth_error=1`);
  }

  const userId   = session.user.id;
  const deviceId = request.cookies.get('ks_pending_device')?.value ?? null;

  // Clear the pending device cookie
  response.cookies.set('ks_pending_device', '', { maxAge: 0, path: '/' });

  const admin = createAdminClient();

  // ── Detect first-time signup ──────────────────────────────────────────────
  // Profile created within the last 2 minutes = brand new Google account
  const { data: profile } = await adminFrom(admin, 'profiles')
    .select('created_at, username')
    .eq('id', userId)
    .single();

  const isNewUser = profile?.created_at
    ? Date.now() - new Date(profile.created_at).getTime() < 2 * 60 * 1000
    : false;

  // ── Migrate guest portfolio if device_id present ──────────────────────────
  let migrationStatus: string | null = null;

  if (deviceId) {
    const { data: result } = await adminRpc(admin, 'migrate_guest_to_user', {
      p_device_id: deviceId,
      p_user_id:   userId,
    });
    migrationStatus = (result as { status: string } | null)?.status ?? null;
  }

  // ── Build redirect URL with welcome params ────────────────────────────────
  const redirectUrl = new URL(`${origin}/`);

  if (migrationStatus === 'migrated' || migrationStatus === 'conflict_resolved') {
    redirectUrl.searchParams.set('ks_migrated', '1');
  }
  if (isNewUser) {
    redirectUrl.searchParams.set('ks_new_user', '1');
  }

  response.headers.set('Location', redirectUrl.toString());
  return response;
}
