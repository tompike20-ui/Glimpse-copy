import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Cloud is strictly additive. If these are unset the app runs exactly as it
 * did in Phase 1 — fully local, no account, no network — and every cloud
 * entry point hides itself. Capture must never depend on a backend.
 */
const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const cloudConfigured = Boolean(URL && ANON);

let clientPromise: Promise<SupabaseClient> | null = null;

/**
 * The SDK is imported dynamically so it lands in its own chunk. A local-only
 * user — which is everyone until they tap Share — never downloads it, and the
 * initial bundle stays roughly half the size it would otherwise be.
 */
export function supabase(): Promise<SupabaseClient> {
  if (!cloudConfigured) {
    return Promise.reject(new Error('Supabase is not configured for this build'));
  }
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(URL!, ANON!, {
        auth: { persistSession: true, autoRefreshToken: true },
      }),
    );
  }
  return clientPromise;
}

export async function currentUserId(): Promise<string | null> {
  if (!cloudConfigured) return null;
  const sb = await supabase();
  const { data } = await sb.auth.getUser();
  return data.user?.id ?? null;
}

/** Magic link — no passwords to store, lose, or leak. */
export async function signIn(email: string): Promise<void> {
  const sb = await supabase();
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const sb = await supabase();
  await sb.auth.signOut();
}
