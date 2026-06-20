import { Loader2Icon } from "lucide-react"

import { cn } from "#lib/cn"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      {...props}
      className={cn("size-4 animate-spin", className)}
      role="status"
      aria-label="Loading"
    />
  )
}

export { Spinner }
