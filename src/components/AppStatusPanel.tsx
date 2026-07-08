import type { JSX } from 'react';

export type AppStatusPanelStatus = 'loading' | 'empty' | 'error';

export type AppStatusPanelProps = {
  status: AppStatusPanelStatus;
  title: string;
  message: string;
  onRetry?: () => void;
};

export function AppStatusPanel({
  status,
  title,
  message,
  onRetry,
}: AppStatusPanelProps): JSX.Element {
  const role = status === 'error' ? 'alert' : 'status';
  const ariaLive = status === 'loading' ? 'polite' : undefined;

  return (
    <div className={`app-status-panel app-status-panel--${status}`} role={role} aria-live={ariaLive}>
      {status === 'loading' ? <span className="app-status-panel__spinner" aria-hidden="true" /> : null}
      <div className="app-status-panel__copy">
        <strong>{title}</strong>
        <span>{message}</span>
      </div>
      {status === 'error' && onRetry ? (
        <button type="button" className="app-status-panel__retry" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}
