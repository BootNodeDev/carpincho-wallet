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
      mutations,
    },
  })
