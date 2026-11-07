// The homes made in this browser, by id (M8). Signed out, they're the only way back to a home;
// signed in, the API also lists the account's own. Storage can be missing or refuse (a private
// window), so every read and write is guarded and the list is simply empty then.

const KEY = 'roomie.homes';

export function browserHomes(): string[] {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** Remembers a home made here, newest first. */
export function rememberHome(id: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify([id, ...browserHomes().filter((h) => h !== id)]));
  } catch {
    // Not remembered: signed in, the account still lists it.
  }
}

/** Whether this visitor has started a home here before: they go straight to Your homes. */
export const hasHomes = () => browserHomes().length > 0;
