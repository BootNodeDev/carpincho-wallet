import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'
import { createQueryClient } from '@/config/queryClient'

// Creates an isolated query cache so tests cannot share CIP-56 server state. Mutations are
// collected at once too: their five-minute default keeps a timer alive that would hold the
// test process open long after the assertions finish.
export const createTestQueryClient = (): QueryClient =>
  createQueryClient({ gcTime: 0 }, { gcTime: 0 })

// Wraps a test subtree in a fresh TanStack Query provider. The client is created once per
// mount, so a re-render does not throw away what a mutation just wrote into the cache.
export const TestQueryClientProvider = ({ children }: { children: ReactNode }): JSX.Element => {
  const [client] = useState(createTestQueryClient)
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
