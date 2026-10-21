import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { en, MessageKey, Messages } from './en';
import { es } from './es';

export type Locale = 'en' | 'es';
export const LOCALES: Locale[] = ['es', 'en'];
const DICTIONARIES: Record<Locale, Messages> = { en, es };
const STORAGE_KEY = 'streamcollab_lang';

function asLocale(value: string | null | undefined): Locale | null {
  const v = value?.toLowerCase().slice(0, 2);
  return v === 'es' || v === 'en' ? v : null;
}

/** ?lang= (links pasted into OBS) → saved choice → browser language → English */
export function detectLocale(): Locale {
  try {
    const fromUrl = asLocale(new URLSearchParams(window.location.search).get('lang'));
    if (fromUrl) return fromUrl;
  } catch {
    // ignore malformed URLs
  }
  try {
    const saved = asLocale(localStorage.getItem(STORAGE_KEY));
    if (saved) return saved;
  } catch {
    // storage unavailable
  }
  return asLocale(navigator.language) ?? 'en';
}

export type TranslateParams = Record<string, string | number>;

export function translate(locale: Locale, key: MessageKey, params?: TranslateParams): string {
  const template = DICTIONARIES[locale][key] ?? en[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, params?: TranslateParams) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function LocaleProvider({ children, initialLocale }: { children: React.ReactNode; initialLocale?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale ?? detectLocale());

  const setLocale = useCallback((next: Locale) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // only for this page load
    }
    setLocaleState(next);
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, t: (key, params) => translate(locale, key, params) }),
    [locale, setLocale]
  );

  // Keep the <html lang> attribute right for screen readers and the browser's spellchecker
  React.useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useT() must be used inside <LocaleProvider>');
  return ctx;
}

export type { MessageKey };
