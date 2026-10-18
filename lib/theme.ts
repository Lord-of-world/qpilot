// Light / dark / system theme. The choice is per browser (localStorage); the
// `dark` class on <html> drives the CSS (app/globals.css). THEME_INIT_SCRIPT
// runs inline in <head> so the first paint already has the right theme.

export type Theme = "system" | "light" | "dark";

const KEY = "qpilot.theme";

export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("${KEY}")||"system";var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);var e=document.documentElement;e.classList.toggle("dark",d);e.style.colorScheme=d?"dark":"light";}catch(_){}})();`;

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(theme: Theme): void {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const el = document.documentElement;
  el.classList.toggle("dark", dark);
  el.style.colorScheme = dark ? "dark" : "light";
}

export function setTheme(theme: Theme): void {
  try {
    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {}
  applyTheme(theme);
  window.dispatchEvent(new CustomEvent("qpilot-theme", { detail: theme }));
}

/** Keeps "system" in step with the OS switching between light and dark. */
export function watchSystemTheme(): () => void {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => { if (getTheme() === "system") applyTheme("system"); };
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
