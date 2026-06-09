"use client";

import { ModuleFailureState } from "@/components/platform/module-boundary";

type PlatformErrorProps = Readonly<{
  error: Error;
  reset: () => void;
}>;

export default function PlatformError({ error, reset }: PlatformErrorProps) {
  return (
    <ModuleFailureState
      moduleName="Product Suite"
      errorMessage={error.message}
      onRetry={reset}
    />
  );
}
