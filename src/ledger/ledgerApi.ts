import { type WalletServiceRequestOptions, walletServiceRequest } from '@/api/walletService'

// Calls the participant JSON API through wallet-service so Carpincho never stores ledger tokens.
// `walletServiceRequest` takes `params?: unknown`, so this is the only thing that types the
// passthrough shape: a misspelled `resource` or an uppercase method fails to compile here.
export const ledgerApi = async <T>(
  params: {
    requestMethod: 'get' | 'post'
    resource: string
    body?: Record<string, unknown>
  },
  options?: WalletServiceRequestOptions,
): Promise<T> => await walletServiceRequest<T>('ledgerApi', params, options)
