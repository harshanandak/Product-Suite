"use client";

import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";

type ModuleBoundaryProps = Readonly<{
  moduleName: string;
  children: ReactNode;
}>;

type ModuleBoundaryState = {
  error: Error | null;
  resetKey: number;
};

export class ModuleBoundary extends Component<
  ModuleBoundaryProps,
  ModuleBoundaryState
> {
  state: ModuleBoundaryState = {
    error: null,
    resetKey: 0,
  };

  static getDerivedStateFromError(
    error: Error,
  ): Pick<ModuleBoundaryState, "error"> {
    return { error };
  }

  componentDidCatch(_error: Error, _errorInfo: ErrorInfo) {
    // React calls this after the fallback is rendered. PR21 keeps the failure
    // local; logging/monitoring policy is handled in the later observability PR.
  }

  handleRetry = () => {
    this.setState((state) => ({
      error: null,
      resetKey: state.resetKey + 1,
    }));
  };

  render() {
    if (this.state.error) {
      return (
        <ModuleFailureState
          moduleName={this.props.moduleName}
          errorMessage={this.state.error.message}
          onRetry={this.handleRetry}
        />
      );
    }

    return <Fragment key={this.state.resetKey}>{this.props.children}</Fragment>;
  }
}

type ModuleFailureStateProps = Readonly<{
  moduleName: string;
  errorMessage?: string;
  onRetry?: () => void;
}>;

export function ModuleFailureState({
  moduleName,
  errorMessage,
  onRetry,
}: ModuleFailureStateProps) {
  return (
    <section className="rounded-md border border-red-200 bg-red-50 p-5 text-red-950">
      <p className="text-sm font-semibold">{moduleName} module could not load</p>
      {errorMessage ? (
        <p className="mt-2 text-sm text-red-800">{errorMessage}</p>
      ) : null}
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-950"
      >
        Try again
      </button>
    </section>
  );
}

type ModuleLoadingStateProps = Readonly<{
  moduleName: string;
}>;

export function ModuleLoadingState({ moduleName }: ModuleLoadingStateProps) {
  return (
    <section className="rounded-md border border-slate-200 bg-white p-5">
      <p className="text-sm font-semibold text-slate-950">
        Loading {moduleName} module
      </p>
      <div className="mt-4 h-2 w-40 rounded bg-slate-200" />
      <div className="mt-2 h-2 w-64 rounded bg-slate-100" />
    </section>
  );
}
