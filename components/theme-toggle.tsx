"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { getTheme, setTheme, watchSystemTheme, type Theme } from "@/lib/theme";

export interface ThemeLabels {
  themeSystem: string;
  themeLight: string;
  themeDark: string;
}

const OPTIONS: { value: Theme; icon: typeof Sun; label: keyof ThemeLabels }[] = [
  { value: "system", icon: Monitor, label: "themeSystem" },
  { value: "light", icon: Sun, label: "themeLight" },
  { value: "dark", icon: Moon, label: "themeDark" },
];

/** Segmented System / Light / Dark switch; `withLabels` shows text next to icons. */
export function ThemeToggle({ labels, withLabels = false, className }: {
  labels: ThemeLabels;
  withLabels?: boolean;
  className?: string;
}) {
  // "system" until mounted — the server can't know the saved choice
  const [theme, setThemeState] = useState<Theme>("system");

  useEffect(() => {
    setThemeState(getTheme());
    const onTheme = (e: Event) => setThemeState((e as CustomEvent<Theme>).detail);
    window.addEventListener("qpilot-theme", onTheme);
    const unwatch = watchSystemTheme();
    return () => { window.removeEventListener("qpilot-theme", onTheme); unwatch(); };
  }, []);

  return (
    <div role="radiogroup" className={cn("inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5", className)}>
      {OPTIONS.map(({ value, icon: Icon, label }) => (
        <button key={value} type="button" role="radio" aria-checked={theme === value}
          title={labels[label]}
          onClick={() => setTheme(value)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md text-xs transition-colors",
            withLabels ? "px-2.5 py-1.5" : "p-1.5",
            theme === value
              ? "bg-background text-foreground shadow-sm ring-1 ring-border"
              : "text-subtle hover:text-foreground",
          )}>
          <Icon className="size-3.5" />
          {withLabels && labels[label]}
        </button>
      ))}
    </div>
  );
}
