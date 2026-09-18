import { ledgerSession } from '@/ledger/ledgerApi'

export interface DarUploadResponse {
  ok: true
  response: unknown
}

// Sends the compiled DAML archive as raw bytes. This is the one ledger call with a body that is
// not JSON, so it does not go through `ledgerApi`.
export const uploadDarFile = async (file: File): Promise<DarUploadResponse> => {
  const session = await ledgerSession()
  const response = await fetch(`${session.baseUrl}/v2/packages`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      'content-type': 'application/octet-stream',
    },
    body: file,
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`ledger HTTP ${response.status}${body === '' ? '' : `: ${body}`}`)
  }
  return { ok: true, response: await response.json().catch(() => undefined) }
}
