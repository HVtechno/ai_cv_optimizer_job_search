import { createContext, useContext, useEffect, useState, useCallback } from "react";

/**
 * ThemeContext — one shared, global theme choice for the whole app
 * (home page, dashboard, AND every modal). Three modes:
 *   "system"  → follow the OS preference (prefers-color-scheme). DEFAULT.
 *   "dark"    → force the existing dark look.
 *   "light"   → force light look (variable overrides in GlobalStyles).
 *
 * The choice is persisted in localStorage under "velora_theme".
 * The RESOLVED theme ("dark" | "light") is written to <html data-theme="...">
 * so CSS (variables + Tailwind class overrides) can repaint accordingly, and is
 * also exposed via the hook for the few components that branch in JS.
 *
 * Purely additive: with nothing stored, the resolved theme follows the system,
 * which on most setups is dark — matching the original default appearance.
 */

const STORAGE_KEY = "velora_theme";
const ThemeContext = createContext(null);

function getSystemTheme() {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readStoredMode() {
  if (typeof window === "undefined") return "system";
  const v = localStorage.getItem(STORAGE_KEY);
  return v === "dark" || v === "light" || v === "system" ? v : "system";
}

export function ThemeProvider({ children }) {
  // mode = the user's CHOICE ("system" | "dark" | "light")
  const [mode, setModeState] = useState(readStoredMode);
  // resolved = the ACTUAL theme in effect ("dark" | "light")
  const [resolved, setResolved] = useState(() =>
    readStoredMode() === "system" ? getSystemTheme() : readStoredMode()
  );

  // Apply resolved theme to <html data-theme> and recompute when mode changes.
  useEffect(() => {
    const apply = () => {
      const next = mode === "system" ? getSystemTheme() : mode;
      setResolved(next);
      if (typeof document !== "undefined") {
        document.documentElement.setAttribute("data-theme", next);
      }
    };
    apply();

    // When in system mode, react live to OS theme changes.
    if (mode === "system" && typeof window !== "undefined" && window.matchMedia) {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => apply();
      mq.addEventListener ? mq.addEventListener("change", handler)
                          : mq.addListener(handler);
      return () => {
        mq.removeEventListener ? mq.removeEventListener("change", handler)
                               : mq.removeListener(handler);
      };
    }
  }, [mode]);

  const setMode = useCallback((next) => {
    setModeState(next);
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, next);
  }, []);

  // Convenience for the navbar sun/moon toggle: flip between explicit
  // light and dark (leaving "system" only reachable via Settings).
  const toggle = useCallback(() => {
    setMode(resolved === "dark" ? "light" : "dark");
  }, [resolved, setMode]);

  return (
    <ThemeContext.Provider value={{ mode, resolved, setMode, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // Safe fallback so a missing provider never crashes the app.
    return { mode: "system", resolved: "dark", setMode: () => {}, toggle: () => {} };
  }
  return ctx;
}
