import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind class names with conflict resolution.
 * Single source for className composition across `packages/ui` and apps
 * (DESIGN §5: tokens-not-values, no ad-hoc styling).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
