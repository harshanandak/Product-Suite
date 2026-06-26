import * as React from "react"
import { CheckIcon, MinusIcon } from "lucide-react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"

import { cn } from "#lib/cn"

/**
 * Token-styled checkbox built on `@radix-ui/react-checkbox` (re-exported by the
 * unified `radix-ui` package, matching the house Select pattern). It inherits
 * Radix's `role="checkbox"`, keyboard (Space toggles) and ARIA wiring.
 *
 * Supports the tri-state `indeterminate` value via `checked={"indeterminate"}`,
 * which renders a minus glyph instead of a check — used for table
 * select-all headers where some, but not all, rows are selected.
 *
 * @example
 * ```tsx
 * <Checkbox checked={value} onCheckedChange={setValue} aria-label="Select row" />
 * <Checkbox checked="indeterminate" onCheckedChange={toggleAll} />
 * ```
 */
function Checkbox({
  className,
  checked,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      checked={checked}
      className={cn(
        "group peer size-4 shrink-0 rounded-[4px] border border-input shadow-xs transition-shadow outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground dark:bg-input/30 dark:aria-invalid:ring-destructive/40 dark:data-[state=checked]:bg-primary",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current transition-none"
      >
        {/*
         * Gate the glyph on the resolved Radix `data-state` (carried by the
         * `group` Root) rather than the raw `checked` prop, so uncontrolled
         * `defaultChecked="indeterminate"` usage — where `checked` is undefined —
         * still shows the minus glyph instead of falling back to the check.
         */}
        <MinusIcon className="hidden size-3.5 group-data-[state=indeterminate]:block" />
        <CheckIcon className="hidden size-3.5 group-data-[state=checked]:block" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
