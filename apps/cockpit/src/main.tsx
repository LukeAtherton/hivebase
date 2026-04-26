import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { AuditCanvas } from './audit/AuditCanvas';
import { useCockpitStore } from './store/cockpitStore';
import './index.css';

// Surface every fetch / mutation error as a toast so silent network drops
// don't make the cockpit look mysteriously frozen.
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000 } },
  queryCache: new QueryCache({
    onError: (err) => {
      useCockpitStore.getState().pushToast({
        kind: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    },
  }),
  mutationCache: new MutationCache({
    onError: (err) => {
      useCockpitStore.getState().pushToast({
        kind: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    },
  }),
});

// Tiny path-based router: avoids pulling in TanStack Router for one secondary
// route. The cockpit is the default surface; /audit-canvas renders the UX-audit
// graph (no API queries, no live cockpit chrome).
const route = window.location.pathname.startsWith('/audit-canvas') ? 'audit' : 'app';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {route === 'audit' ? <AuditCanvas /> : <App />}
    </QueryClientProvider>
  </StrictMode>,
);
