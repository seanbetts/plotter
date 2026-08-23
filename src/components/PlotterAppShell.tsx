import { AppShell, type ContextExportBuilder } from '@local-web/ui';
import type { PropsWithChildren } from 'react';
import { plotterAppIdentity } from '../config/appIdentity';

type PlotterAppShellProps = PropsWithChildren<{
  buildContextExport?: ContextExportBuilder;
}>;

export function PlotterAppShell({ children, buildContextExport }: PlotterAppShellProps) {
  return (
    <AppShell
      app={plotterAppIdentity}
      buildContextExport={buildContextExport}
      contentMode="edge-to-edge"
    >
      {children}
    </AppShell>
  );
}
