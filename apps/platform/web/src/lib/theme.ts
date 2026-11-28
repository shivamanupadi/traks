import { useCallback, useSyncExternalStore } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'traks.theme';
const LIGHT_CHROME = '#f9f8f6';
const DARK_CHROME = '#14131a';

function stored(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    // Storage blocked (private mode): fall back to the OS setting.
  }
  return 'system';
}

const media = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();
let preference = stored();

function apply(): void {
  const dark = preference === 'dark' || (preference === 'system' && media.matches);
  document.documentElement.classList.toggle('dark', dark);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? DARK_CHROME : LIGHT_CHROME);
}

media.addEventListener('change', () => {
  if (preference === 'system') apply();
});

export function setThemePreference(next: ThemePreference): void {
  preference = next;
  try {
    if (next === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Not persisted; still applies for this session.
  }
  apply();
  listeners.forEach(l => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Current preference plus a cycler (system -> light -> dark -> system). */
export function useTheme(): { theme: ThemePreference; cycle: () => void } {
  const theme = useSyncExternalStore(subscribe, () => preference);
  const cycle = useCallback(() => {
    setThemePreference(theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system');
  }, [theme]);
  return { theme, cycle };
}

apply();
