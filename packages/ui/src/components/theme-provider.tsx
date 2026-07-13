import * as React from "react";

/**
 * Theme provider (DESIGN §5 / §8). Dark mode is class-based: the `.dark` class
 * is toggled on <html>, and every surface recolors via semantic tokens. No
 * component ever reads raw oklch values.
 */
export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = "ps-theme";

function getSystemTheme(): ResolvedTheme {
  if (typeof globalThis.window !== "undefined" && typeof globalThis.matchMedia === "function") {
    return globalThis.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return "light";
}

export function applyTheme(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  // Swap the theme WITHOUT animating. Many surfaces use `transition-colors`, so
  // flipping the `.dark` class would morph every color at once — a janky,
  // staggered full-page transition. Disable all transitions for the swap, force a
  // reflow to commit it instantly, then re-enable — so the theme change is snappy
  // while hover/layout transitions are unaffected afterwards.
  const disable = document.createElement("style");
  disable.appendChild(
    document.createTextNode("*,*::before,*::after{transition:none !important}"),
  );
  document.head.appendChild(disable);

  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;

  // Reading a computed style forces the browser to apply the swap while
  // transitions are off; then remove the override so later interactions animate.
  void globalThis.getComputedStyle(root).transitionProperty;
  disable.remove();
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
}: Readonly<{
  children: React.ReactNode;
  defaultTheme?: Theme;
}>) {
  const [theme, setThemeState] = React.useState<Theme>(() => {
    if (typeof globalThis.window === "undefined") return defaultTheme;
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" || stored === "system"
      ? stored
      : defaultTheme;
  });

  const resolvedTheme: ResolvedTheme =
    theme === "system" ? getSystemTheme() : theme;

  React.useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  React.useEffect(() => {
    if (theme !== "system" || typeof globalThis.window === "undefined") return;
    const mq = globalThis.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme(getSystemTheme());
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = React.useCallback((next: Theme) => {
    setThemeState(next);
    if (typeof globalThis.window !== "undefined") localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const toggle = React.useCallback(() => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }, [resolvedTheme, setTheme]);

  const value = React.useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme, toggle }),
    [theme, resolvedTheme, setTheme, toggle],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}
