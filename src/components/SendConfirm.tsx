import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { formatTokenAmount } from '@/cip56/amount'
import type { TokenHoldingSummary } from '@/cip56/holdings'
import { transferTimeLabel } from '@/cip56/transfers'
import {
  type Cip56SendApi,
  defaultSendApi,
  type TransferDeadline,
  transferDeadlineExpiration,
} from '@/components/SendTokenForm'
import { PrimaryButton, SecondaryButton } from '@/components/ui/Button'
import { JsonView } from '@/components/ui/JsonView'
import { toast } from '@/components/ui/toast'
import { invalidateTokenState } from '@/config/queryKeys'
import { shortMiddle } from '@/utils/account'
import type { AccountPublic } from '@/vault/types'
import { useVault } from '@/vault/useVault'

export interface SendConfirmProps {
  account: AccountPublic
  summary: TokenHoldingSummary
  recipient: string
  amount: string
  memo: string
  deadline: TransferDeadline
  sendApi?: Cip56SendApi
  onCancel: () => void
  onSent: () => void
}

const Row = ({ label, children }: { label: string; children: ReactNode }): JSX.Element => (
  <div className="flex items-start justify-between gap-3 py-1.5">
    <span className="text-[0.78rem] font-semibold text-muted-foreground">{label}</span>
    <span className="min-w-0 break-all text-right text-[0.86rem] text-foreground">{children}</span>
  </div>
)

// Confirmation screen: human-readable summary, the raw request JSON behind an expander,
// then the actual submit. Carpincho stays the signer of the prepared transaction.
export const SendConfirm = ({
  account,
  summary,
  recipient,
  amount,
  memo,
  deadline,
  sendApi = defaultSendApi,
  onCancel,
  onSent,
}: SendConfirmProps): JSX.Element => {
  const vault = useVault()
  const queryClient = useQueryClient()

  const expirationDate = transferDeadlineExpiration(deadline).toISOString()
  const trimmedMemo = memo.trim()
  // Shared by the inspector JSON and the actual submission so the two cannot drift.
  const shared = {
    recipient: recipient.trim(),
    amount: amount.trim(),
    ...(trimmedMemo === '' ? {} : { memo: trimmedMemo }),
    expirationDate,
  }
  const request = { sender: account.partyId, instrumentId: summary.instrumentId?.id, ...shared }

  // A sent transfer leaves the sender's balance and joins the receiver's pending list, so the
  // mutation refreshes both caches as soon as it lands.
  const submit = useMutation({
    mutationFn: async () => {
      if (summary.instrumentId?.id === undefined) {
        throw new Error('Token is missing an instrument id')
      }
      return await sendApi.createTokenTransfer({
        account,
        instrumentId: summary.instrumentId,
        ...shared,
        signMessage: vault.signMessage,
        recordTransaction: vault.recordTransaction,
      })
    },
    // Not awaited: the transfer is already submitted, and the reads have no timeout, so
    // waiting on them would leave a finished send stuck on "Sending..." with the sheet open.
    onSuccess: () => {
      void invalidateTokenState(queryClient, account)
    },
  })
  const submitError = submit.error?.message

  const onConfirm = async (): Promise<void> => {
    try {
      await submit.mutateAsync()
      toast.success('Transfer submitted.')
      onSent()
    } catch (err) {
      toast.error(`Send failed: ${(err as Error).message}`)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {submitError === undefined ? null : (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[0.82rem] text-danger">
          {submitError}
        </div>
      )}

      <div className="divide-y divide-border rounded-md border border-border px-3 py-1">
        <Row label="To">{shortMiddle(recipient.trim(), 12, 7)}</Row>
        <Row label="Amount">
          {formatTokenAmount(amount.trim())} {summary.tokenLabel}
        </Row>
        <Row label="Expires">{transferTimeLabel(expirationDate)}</Row>
        {trimmedMemo === '' ? null : <Row label="Memo">{trimmedMemo}</Row>}
      </div>

      <details className="rounded-md border border-border bg-surface">
        <summary
          data-testid="send-view-data"
          className="cursor-pointer select-none px-3 py-2 text-[0.78rem] font-semibold text-muted-foreground"
        >
          View data
        </summary>
        <div className="border-t border-border">
          <JsonView
            value={request}
            className="rounded-none border-0"
          />
        </div>
      </details>

      <div className="grid grid-cols-2 gap-3">
        <SecondaryButton
          data-testid="send-cancel"
          onClick={onCancel}
          disabled={submit.isPending}
        >
          Cancel
        </SecondaryButton>
        <PrimaryButton
          data-testid="send-confirm"
          disabled={submit.isPending}
          onClick={() => {
            void onConfirm()
          }}
        >
          {submit.isPending ? 'Sending...' : 'Confirm'}
        </PrimaryButton>
      </div>
    </div>
  )
}
