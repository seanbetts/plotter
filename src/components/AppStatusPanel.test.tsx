import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppStatusPanel } from './AppStatusPanel';

describe('AppStatusPanel', () => {
  it('renders loading as a polite status with a hidden spinner', () => {
    const { container } = render(
      <AppStatusPanel
        status="loading"
        title="Loading Plotter"
        message="Preparing your trip map."
      />,
    );

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('Loading Plotter');
    expect(status).toHaveTextContent('Preparing your trip map.');
    expect(container.querySelector('.app-status-panel__spinner')).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders loaded empty trip as a status without a spinner', () => {
    const { container } = render(
      <AppStatusPanel
        status="empty"
        title="No stops in this trip yet"
        message="Search for a destination or add a stop from the map."
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('No stops in this trip yet');
    expect(screen.getByRole('status')).toHaveTextContent('Search for a destination or add a stop from the map.');
    expect(container.querySelector('.app-status-panel__spinner')).not.toBeInTheDocument();
  });

  it('renders errors as alerts with an optional retry action', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(
      <AppStatusPanel
        status="error"
        title="Unable to load trip data"
        message="Network unavailable."
        onRetry={onRetry}
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Unable to load trip data');
    expect(alert).toHaveTextContent('Network unavailable.');

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
