import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <section className="page-card">
          <span className="eyebrow">UNEXPECTED ERROR</span>
          <h2>页面渲染出错</h2>
          <p className="muted">{this.state.error.message}</p>
          <div className="inline-form">
            <button className="primary" onClick={() => this.setState({ error: null })}>
              重试
            </button>
            <button className="ghost" onClick={() => window.location.reload()}>
              刷新页面
            </button>
          </div>
        </section>
      );
    }
    return this.props.children;
  }
}
