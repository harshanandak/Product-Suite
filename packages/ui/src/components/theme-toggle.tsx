import { Moon, Sun } from "lucide-react";

import { Button } from "./button";
import { useTheme } from "./theme-provider";

/**
 * Dark/light toggle for the top bar (DESIGN §8: dark mode on every surface).
 */
export function ThemeToggle({ className }: Readonly<{ className?: string }>) {
  const { resolvedTheme, toggle } = useTheme();
  const next = resolvedTheme === "dark" ? "light" : "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      onClick={toggle}
      className={className}
    >
      {resolvedTheme === "dark" ? <Sun /> : <Moon />}
    </Button>
  );
}
