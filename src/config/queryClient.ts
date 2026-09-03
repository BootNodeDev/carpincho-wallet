import { QueryClient, type QueryClientConfig } from '@tanstack/react-query'

type Defaults = NonNullable<QueryClientConfig['defaultOptions']>
type QueryDefaults = Defaults['queries']
type MutationDefaults = Defaults['mutations']

// Shared TanStack Query policy: server state is polled explicitly, never on focus or retry.
export const createQueryClient = (
  queries: QueryDefaults = {},
  mutations: MutationDefaults = {},
): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: false,
        ...queries,
      },
      mutations: {
        // wallet-service can sit on localhost, where the browser reporting itself offline says
        // nothing about reachability. Without this a write would be parked until the browser
        // claims a connection again, and its promise would never settle.
        networkMode: 'always',
        ...mutations,
      },
    },
  })
