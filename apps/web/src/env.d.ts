/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The Supabase project to sign in with (PLAN.md M6); without it, sign-in is off. */
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
