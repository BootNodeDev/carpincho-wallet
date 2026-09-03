import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { PrimaryButton } from '@/components/ui/Button'
import { TextInput } from '@/components/ui/TextInput'
import { toast } from '@/components/ui/toast'
import { JsonField } from '@/components/utils/JsonField'
import { UpdateIdResult } from '@/components/utils/UpdateIdResult'
import { invalidateActiveContracts } from '@/config/queryKeys'
import { createContract as defaultCreateContract } from '@/ledger/contracts'
import { parseJsonObject } from '@/utils/json'
import type { AccountPublic } from '@/vault/types'
import { useVault } from '@/vault/useVault'

interface CreateContractUtilProps {
  account: AccountPublic
  createContract?: typeof defaultCreateContract
}

// Submits one generic CreateCommand and surfaces the resulting update id for copying.
export const CreateContractUtil = ({
  account,
  createContract = defaultCreateContract,
}: CreateContractUtilProps): JSX.Element => {
  const vault = useVault()
  const queryClient = useQueryClient()
  const [templateId, setTemplateId] = useState('')
  const [json, setJson] = useState('{}')
  const [jsonValid, setJsonValid] = useState(true)

  const submit = useMutation({
    mutationFn: async () =>
      await createContract({
        account,
        templateId: templateId.trim(),
        createArguments: parseJsonObject(json, 'Create arguments'),
        signMessage: vault.signMessage,
        recordTransaction: vault.recordTransaction,
      }),
    // Not awaited: the contract exists, and the list it feeds is read from another screen.
    onSuccess: () => {
      toast.success('Contract created')
      void invalidateActiveContracts(queryClient, account.partyId)
    },
    onError: (err) => toast.error(err.message),
  })
  const busy = submit.isPending
  // A resubmit clears the previous id rather than leaving a stale one under the form.
  const updateId = busy ? undefined : submit.data?.updateId
  const canSubmit = templateId.trim() !== '' && jsonValid && !busy

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        submit.mutate()
      }}
    >
      <label
        htmlFor="create-template-id"
        className="flex flex-col gap-2 text-[0.82rem] font-semibold uppercase tracking-wider text-muted-foreground"
      >
        Template ID
        <TextInput
          id="create-template-id"
          data-testid="create-template-id"
          value={templateId}
          onChange={(event) => setTemplateId(event.currentTarget.value)}
          placeholder="package:Module:Template"
          className="font-mono text-[0.9rem] normal-case tracking-normal"
        />
      </label>
      <JsonField
        id="create-arguments-json"
        label="Create arguments JSON"
        value={json}
        onChange={setJson}
        onValidityChange={setJsonValid}
      />
      {updateId === undefined ? null : <UpdateIdResult updateId={updateId} />}
      <PrimaryButton
        type="submit"
        className="w-full"
        data-testid="create-contract-submit"
        disabled={!canSubmit}
      >
        {busy ? 'Creating...' : 'Create'}
      </PrimaryButton>
    </form>
  )
}
