import { render, screen, within } from '@testing-library/react';
import type { ContextExportBuilder } from '@local-web/ui';
import { describe, expect, it, vi } from 'vitest';
import { PlotterAppShell } from './PlotterAppShell';

describe('PlotterAppShell', () => {
  it('provides the public edge-to-edge platform shell', () => {
    render(
      <PlotterAppShell>
        <section aria-label="Plotter test content" />
      </PlotterAppShell>,
    );

    const locationNavigation = screen.getByRole('navigation', { name: 'Location' });
    expect(within(locationNavigation).getByText('Local')).toBeInTheDocument();
    expect(within(locationNavigation).getByRole('link', { name: 'System Index' })).toHaveAttribute('href', '/');
    expect(within(locationNavigation).getByText('Plotter')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('group', { name: 'Colour mode' })).toBeInTheDocument();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('main')).toHaveClass('lwp-platform-shell__main--edge-to-edge');
    expect(screen.getByRole('region', { name: 'Plotter test content' })).toBeInTheDocument();
  });

  it('forwards the public context builder without changing the edge-to-edge shell', () => {
    const buildContextExport = vi.fn() as ContextExportBuilder;

    render(
      <PlotterAppShell buildContextExport={buildContextExport}>
        <section aria-label="Plotter export content" />
      </PlotterAppShell>,
    );

    expect(screen.getByRole('button', { name: 'Export context' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveClass('lwp-platform-shell__main--edge-to-edge');
    expect(screen.getByRole('region', { name: 'Plotter export content' })).toBeInTheDocument();
  });
});
