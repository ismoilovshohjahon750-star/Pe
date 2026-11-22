import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    message: '',
  };

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error?.message || 'Kutilmagan brauzer xatoligi',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[UI ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-full bg-[#03060C] text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-2xl bg-[#0F172A] border border-white/20 p-5 text-center space-y-3">
            <h1 className="text-base font-semibold text-white">Sahifa yuklanishida xatolik</h1>
            <p className="text-xs text-slate-300 break-words">{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-full text-xs font-medium bg-white/15 hover:bg-white/25 border border-white/25 text-white cursor-pointer"
            >
              Sahifani qayta yuklash
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
