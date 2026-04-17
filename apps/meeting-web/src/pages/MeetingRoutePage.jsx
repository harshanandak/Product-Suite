import { Component, Suspense, lazy } from "react";

import { WorkspaceShellFallback } from "@/pages/WorkspaceShellFallback";

const WorkspaceApp = lazy(() => import("@/App"));

class WorkspaceLoadErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch() {}

  handleRetry = () => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  render() {
    const { children, fallbackProps } = this.props;
    const isIndex = fallbackProps?.variant === "index";

    if (this.state.hasError) {
      return (
        <WorkspaceShellFallback
          {...fallbackProps}
          status="error"
          title={isIndex ? "Failed to load meetings" : "Failed to load workspace"}
          description={
            isIndex
              ? "The meetings bundle could not be loaded. Refresh the page to retry."
              : "The workspace bundle could not be loaded. Refresh the page to retry."
          }
          onRetry={this.handleRetry}
        />
      );
    }

    return children;
  }
}

export function MeetingRoutePage({
  brand = "Meeting Agent",
  eyebrow,
  title,
  description,
  variant = "workspace",
  highlights = [],
}) {
  const fallbackProps = {
    brand,
    eyebrow,
    title,
    description,
    variant,
    highlights,
  };

  return (
    <WorkspaceLoadErrorBoundary fallbackProps={fallbackProps}>
      <Suspense fallback={<WorkspaceShellFallback {...fallbackProps} status="loading" />}>
        <WorkspaceApp />
      </Suspense>
    </WorkspaceLoadErrorBoundary>
  );
}
