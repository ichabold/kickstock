/**
 * POST /api/trade
 * Executes a buy or sell via the execute_trade RPC (SECURITY DEFINER, atomic).
 *
 * Auth strategy:
 *   • Authenticated user → sessioned Supabase client (anon key + JWT).
 *     The RPC receives auth.uid() from the JWT and can verify ownership.
 *   • Anonymous player  → admin client scoped to the device_id.
 *
 * Body: { nationId: string, mode: 'buy'|'sell', quantity: number }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient as createServerClient } from '@/lib/supabase/server';
import * as Sentry from '@sentry/nextjs';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { nationId, mode, quantity } = body;

    if (!nationId || typeof nationId !== 'string') {
      return NextResponse.json({ code: 'INVALID_PARAMS', error: 'nationId manquant' }, { status: 400 });
    }
    if (!['buy', 'sell'].includes(mode)) {
      return NextResponse.json({ code: 'INVALID_MODE', error: 'mode doit être buy ou sell' }, { status: 400 });
    }
    if (!quantity || typeof quantity !== 'number' || quantity <= 0 || !Number.isInteger(quantity)) {
      return NextResponse.json({ code: 'INVALID_QUANTITY', error: 'quantité invalide' }, { status: 400 });
    }

    const deviceId = req.headers.get('X-Device-ID') ?? null;
    if (!deviceId) {
      return NextResponse.json({ code: 'MISSING_DEVICE_ID', error: 'X-Device-ID requis' }, { status: 400 });
    }

    // Try to get the authenticated user session
    let userId: string | null = null;
    let useSessionedClient = false;
    let sessionedClient: Awaited<ReturnType<typeof createServerClient>> | null = null;

    try {
      sessionedClient = await createServerClient();
      const { data: { user } } = await sessionedClient.auth.getUser();
      if (user?.id) {
        userId = user.id;
        useSessionedClient = true;
      }
    } catch { /* anonymous player — fall through to admin client */ }

    // Authenticated: use sessioned client so auth.uid() is set inside the RPC
    // Anonymous:     use admin client (no session to pass)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client: any = useSessionedClient ? sessionedClient! : createAdminClient();

    const { data, error } = await client.rpc('execute_trade', {
      p_device_id: deviceId,
      p_nation_id: nationId,
      p_mode:      mode,
      p_quantity:  Math.floor(quantity),
      p_user_id:   userId,
    });

    if (error) throw error;

    const result = data as { ok?: boolean; error?: string; code?: string; new_cash?: number; new_held?: number; price?: number; fee?: number };
    if (result?.error) {
      const code = result.code ?? errorToCode(result.error);
      return NextResponse.json({ code, error: result.error }, { status: 422 });
    }

    return NextResponse.json({
      ok:      true,
      newCash: result?.new_cash,
      newHeld: result?.new_held,
      price:   result?.price,
      fee:     result?.fee,
    });

  } catch (err) {
    Sentry.captureException(err, { tags: { route: 'POST /api/trade' } });
    console.error('[POST /api/trade]', err);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', error: 'Erreur interne' },
      { status: 500 },
    );
  }
}

function errorToCode(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('insufficient') || m.includes('insuffisant')) return 'INSUFFICIENT_FUNDS';
  if (m.includes('eliminated') || m.includes('éliminé'))       return 'NATION_ELIMINATED';
  if (m.includes('market') && m.includes('closed'))            return 'MARKET_CLOSED';
  if (m.includes('not found') || m.includes('introuvable'))    return 'NOT_FOUND';
  return 'TRADE_ERROR';
}
