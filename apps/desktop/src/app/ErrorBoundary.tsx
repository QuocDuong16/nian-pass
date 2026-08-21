import { Component, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  override state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(): void {
    // Intentionally no runtime logging: component state may include vault metadata.
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <main className="fatal-view" role="alert">
          <section className="fatal-card">
            <p className="eyebrow">Nian Pass</p>
            <h1>The application could not continue.</h1>
            <p>Close Nian Pass and open it again.</p>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}
