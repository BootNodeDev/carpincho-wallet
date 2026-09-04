type Hosted = readonly string[] | 'all'

const partyFromResource = (resource: string): string =>
  decodeURIComponent(resource.replace('/v2/parties/', ''))

// Answers the party-hosting lookup VaultProvider makes, so a test scopes accounts without
// reaching a ledger. Pass 'all' to host every party asked about, a list to host exactly those,
// or a function when a test changes its mind mid-run (the endpoint moved, the ledger did).
// Returns the restore function for afterEach.
export const installHostedParties = (hosted: Hosted | (() => Hosted) = 'all'): (() => void) => {
  const original = globalThis.fetch
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body ?? '{}')) as {
      params?: { resource?: string }
    }
    const partyId = partyFromResource(request.params?.resource ?? '')
    const answer = typeof hosted === 'function' ? hosted() : hosted
    const isHosted = answer === 'all' || answer.includes(partyId)
    return new Response(
      JSON.stringify({
        result: { partyDetails: isHosted ? [{ party: partyId, isLocal: true }] : [] },
      }),
      { status: 200 },
    )
  }
  return () => {
    globalThis.fetch = original
  }
}
