import { cn } from "@/lib/utils"

function AspectRatio({
  ratio,
  className,
  ...props
}) {
  return (
    <div
      data-slot="aspect-ratio"
      style={
        {
          "--ratio": ratio
        }
      }
      className={cn("relative aspect-[var(--ratio)]", className)}
      {...props} />
  );
}

export { AspectRatio }
