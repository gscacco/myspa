/** Shared classification for Clojure and ClojureScript Markdown fences. */

export const EXECUTABLE_LANGUAGES = new Set(['clojurescript', 'cljs loom']);
export const CLOJURE_LANGUAGES = new Set(['clojure', 'cljs', 'clojurescript', 'cljs loom']);

export function normalizeCodeLanguage(language) {
  return String(language || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function isExecutableLanguage(language) {
  return EXECUTABLE_LANGUAGES.has(normalizeCodeLanguage(language));
}

export function isClojureLanguage(language) {
  return CLOJURE_LANGUAGES.has(normalizeCodeLanguage(language));
}

export const EXECUTABLE_FENCE_OPENING = /^ {0,3}(`{3,}|~{3,})[ \t]*(?:clojurescript|cljs[ \t]+loom)[ \t]*\r?\n/i;
