import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Sign-in (PLAN.md M6), only for the steps that call an LLM. The browser signs in with Supabase
// Auth, which keeps the session and refreshes it; data still goes through our API, which checks
// the session's token itself.

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/** Supabase Auth, or none when sign-in isn't set up here. */
export const supabase: SupabaseClient | undefined =
  url && key ? createClient(url, key, { auth: { flowType: 'pkce' } }) : undefined;

/** The access token to send the API for the steps that call an LLM; none when signed out. */
export async function accessToken(): Promise<string | undefined> {
  if (!supabase) return undefined;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token;
}

/** Emails a sign-in link, which brings whoever opens it back to this page, signed in. */
export async function signInWithEmail(email: string): Promise<void> {
  if (!supabase) throw new Error("Sign-in isn't set up here.");
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: location.href },
  });
  if (error) throw new Error(error.message);
}

/** Goes to Google to sign in, and comes back to this page. */
export async function signInWithGoogle(): Promise<void> {
  if (!supabase) throw new Error("Sign-in isn't set up here.");
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.href },
  });
  if (error) throw new Error(error.message);
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut();
}
