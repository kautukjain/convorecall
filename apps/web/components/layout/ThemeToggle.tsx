"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "opengong-theme";

const OPTIONS: Array<{ value: Theme; label: string; Icon: typeof Sun }> = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

/**
 * Three states, not two. "System" is a real choice — it means "keep following the OS" —
 * and collapsing it into a light/dark switch silently opts the user out of that.
 *
 * The attribute is applied by an inline script before first paint (see layout.tsx); this
 * component only reflects and updates it, so there is no flash of the wrong theme.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    setTheme(stored ?? "system");
    setMounted(true);
  }, []);

  function choose(next: Theme): void {
    setTheme(next);
    if (next === "system") {
      localStorage.removeItem(STORAGE_KEY);
      document.documentElement.removeAttribute("data-theme");
    } else {
      localStorage.setItem(STORAGE_KEY, next);
      document.documentElement.setAttribute("data-theme", next);
    }
  }

  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-md border border-border bg-raised p-0.5"
      role="radiogroup"
      aria-label="Colour theme"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        // Before mount the stored value is unknown; rendering none as selected avoids
        // asserting the wrong one for a frame.
        const selected = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={label}
            onClick={() => choose(value)}
            // The selected option lifts onto the surface colour. A segmented control
            // reads faster when the current choice is raised than when it is only tinted.
            className={`rounded-sm px-2 py-1 transition-[background-color,color,box-shadow] duration-150 ${
              selected
                ? "bg-surface text-fg elev-1"
                : "text-subtle hover:text-fg"
            }`}
          >
            <Icon size={14} strokeWidth={1.75} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

/**
 * Runs before paint. Kept as a string so it can be inlined in <head> — a React effect
 * would run after the first paint, which is exactly when the flash happens.
 */
export const THEME_INIT_SCRIPT = `
try {
  var t = localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
  if (t === "light" || t === "dark") {
    document.documentElement.setAttribute("data-theme", t);
  }
} catch (e) {}
`;
