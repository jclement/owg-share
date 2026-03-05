import { createContext, useContext, useEffect, useState, useCallback } from "react";

type Theme = "system" | "light" | "dark";

interface ThemeContext {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolved: "light" | "dark";
}

const ThemeCtx = createContext<ThemeContext>({
  theme: "system",
  setTheme: () => {},
  resolved: "dark",
});

export function useTheme() {
  return useContext(ThemeCtx);
}

function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolve(theme: Theme): "light" | "dark" {
  return theme === "system" ? getSystemTheme() : theme;
}

function applyTheme(resolved: "light" | "dark") {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", resolved === "dark" ? "#0a0a0a" : "#ffffff");
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    return (localStorage.getItem("theme") as Theme) || "system";
  });
  const [resolved, setResolved] = useState<"light" | "dark">(() => resolve(theme));

  const setTheme = useCallback((t: Theme) => {
    localStorage.setItem("theme", t);
    setThemeState(t);
  }, []);

  useEffect(() => {
    const r = resolve(theme);
    setResolved(r);
    applyTheme(r);
  }, [theme]);

  // Listen for OS theme changes when in system mode
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (theme === "system") {
        const r = getSystemTheme();
        setResolved(r);
        applyTheme(r);
      }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  return (
    <ThemeCtx.Provider value={{ theme, setTheme, resolved }}>
      {children}
    </ThemeCtx.Provider>
  );
}
