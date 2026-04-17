import * as React from "react"
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils"

const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-2xl border px-4 py-3 text-left text-sm has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2.5 [&_svg]:row-span-2 [&_svg]:translate-y-0.5 [&_svg]:text-current [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        destructive:
          "bg-card text-destructive *:data-[slot=alert-description]:text-destructive/90 [&_svg]:text-current",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const Alert = React.forwardRef(function Alert({ className, variant, ...props }, ref) {
  return (
    <div
      ref={ref}
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props} />
  );
});

const AlertTitle = React.forwardRef(function AlertTitle({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      data-slot="alert-title"
      className={cn(
        "font-heading font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground",
        className
      )}
      {...props} />
  );
});

const AlertDescription = React.forwardRef(function AlertDescription({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      data-slot="alert-description"
      className={cn(
        "text-sm text-balance text-muted-foreground md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4",
        className
      )}
      {...props} />
  );
});

const AlertAction = React.forwardRef(function AlertAction({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      data-slot="alert-action"
      className={cn("absolute top-2.5 right-3", className)}
      {...props} />
  );
});

export { Alert, AlertTitle, AlertDescription, AlertAction }
