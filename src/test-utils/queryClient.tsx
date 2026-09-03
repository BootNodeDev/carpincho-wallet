import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'
import { createQueryClient } from '@/config/queryClient'

// Creates an isolated query cache so tests cannot share CIP-56 server state. Mutations are
// never collected: the client dies with the test, and any finite mutation gcTime schedules a
// timer that holds the test process open — zero included, since collecting a mutation that is
// still pending at teardown only reschedules itself, spinning the process forever.
export const createTestQueryClient = (): QueryClient =>
  createQueryClient({ gcTime: 0 }, { gcTime: Number.POSITIVE_INFINITY })

// Wraps a test subtree in a fresh TanStack Query provider. The client is created once per
// mount, so a re-render does not throw away what a mutation just wrote into the cache.
export const TestQueryClientProvider = ({ children }: { children: ReactNode }): JSX.Element => {
  const [client] = useState(createTestQueryClient)
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
