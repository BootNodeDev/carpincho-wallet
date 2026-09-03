import { QueryClient, type QueryClientConfig } from '@tanstack/react-query'

type Defaults = NonNullable<QueryClientConfig['defaultOptions']>
type QueryDefaults = Defaults['queries']
type MutationDefaults = Defaults['mutations']

// wallet-service can sit on localhost, where the browser reporting itself offline says nothing
// about reachability. Every request is attempted anyway: without this a write is parked until
// the browser claims a connection again and its promise never settles, and a read is parked with
// no data and no error, so the footer reads disconnected and a poll never corrects it.
const ATTEMPT_WHILE_OFFLINE = 'always'

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
        networkMode: ATTEMPT_WHILE_OFFLINE,
        ...queries,
      },
      mutations: {
        networkMode: ATTEMPT_WHILE_OFFLINE,
        ...mutations,
      },
    },
  })
