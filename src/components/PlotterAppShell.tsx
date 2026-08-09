import { AppShell } from '@local-web/ui';
import type { PropsWithChildren } from 'react';
import { plotterAppIdentity } from '../config/appIdentity';

export function PlotterAppShell({ children }: PropsWithChildren) {
  return (
    <AppShell app={plotterAppIdentity} contentMode="edge-to-edge">
      {children}
    </AppShell>
  );
}
