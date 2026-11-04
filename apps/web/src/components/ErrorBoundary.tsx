import { Component, type ReactNode } from 'react';
import { ErrorState } from './ErrorState';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * 严重错误边界：渲染崩溃时页面无法继续操作，因此使用页面级 ErrorState，
 * 而不是 Toast；技术堆栈折叠在“查看详细信息”里。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <ErrorState
          title="页面渲染出错"
          message="页面组件渲染时发生异常，当前页面无法继续操作。可以重试渲染，或刷新整个页面。"
          detail={this.state.error.stack ?? this.state.error.message}
          onRetry={() => this.setState({ error: null })}
          retryLabel="重试渲染"
          secondaryAction={{
            label: '刷新页面',
            onClick: () => window.location.reload(),
          }}
        />
      );
    }
    return this.props.children;
  }
}
