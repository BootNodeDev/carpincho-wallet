import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { PrimaryButton } from '@/components/ui/Button'
import { TextInput } from '@/components/ui/TextInput'
import { toast } from '@/components/ui/toast'
import { JsonField } from '@/components/utils/JsonField'
import { UpdateIdResult } from '@/components/utils/UpdateIdResult'
import { invalidateActiveContracts } from '@/config/queryKeys'
import { exerciseContract as defaultExerciseContract } from '@/ledger/contracts'
import { parseJsonObject } from '@/utils/json'
import type { AccountPublic } from '@/vault/types'
import { useVault } from '@/vault/useVault'

interface ExerciseChoiceUtilProps {
  account: AccountPublic
  exerciseContract?: typeof defaultExerciseContract
}

// Submits one generic ExerciseCommand and surfaces the resulting update id for copying.
export const ExerciseChoiceUtil = ({
  account,
  exerciseContract = defaultExerciseContract,
}: ExerciseChoiceUtilProps): JSX.Element => {
  const vault = useVault()
  const queryClient = useQueryClient()
  const [templateId, setTemplateId] = useState('')
  const [contractId, setContractId] = useState('')
  const [choice, setChoice] = useState('')
  const [json, setJson] = useState('{}')
  const [jsonValid, setJsonValid] = useState(true)

  const submit = useMutation({
    mutationFn: async () =>
      await exerciseContract({
        account,
        templateId: templateId.trim(),
        contractId: contractId.trim(),
        choice: choice.trim(),
        choiceArgument: parseJsonObject(json, 'Choice argument'),
        signMessage: vault.signMessage,
        recordTransaction: vault.recordTransaction,
      }),
    // Not awaited: the choice is exercised, and the list it feeds is read from another screen.
    onSuccess: () => {
      toast.success('Choice exercised')
      void invalidateActiveContracts(queryClient, account.partyId)
    },
    onError: (err) => toast.error(err.message),
  })
  const busy = submit.isPending
  // A resubmit clears the previous id rather than leaving a stale one under the form.
  const updateId = busy ? undefined : submit.data?.updateId

  const canSubmit =
    templateId.trim() !== '' &&
    contractId.trim() !== '' &&
    choice.trim() !== '' &&
    jsonValid &&
    !busy

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        submit.mutate()
      }}
    >
      <label
        htmlFor="exercise-template-id"
        className="flex flex-col gap-2 text-[0.82rem] font-semibold uppercase tracking-wider text-muted-foreground"
      >
        Template ID
        <TextInput
          id="exercise-template-id"
          data-testid="exercise-template-id"
          value={templateId}
          onChange={(event) => setTemplateId(event.currentTarget.value)}
          placeholder="package:Module:TemplateOrInterface"
          className="font-mono text-[0.9rem] normal-case tracking-normal"
        />
      </label>
      <label
        htmlFor="exercise-contract-id"
        className="flex flex-col gap-2 text-[0.82rem] font-semibold uppercase tracking-wider text-muted-foreground"
      >
        Contract ID
        <TextInput
          id="exercise-contract-id"
          data-testid="exercise-contract-id"
          value={contractId}
          onChange={(event) => setContractId(event.currentTarget.value)}
          placeholder="active contract id"
          className="font-mono text-[0.9rem] normal-case tracking-normal"
        />
      </label>
      <label
        htmlFor="exercise-choice"
        className="flex flex-col gap-2 text-[0.82rem] font-semibold uppercase tracking-wider text-muted-foreground"
      >
        Choice
        <TextInput
          id="exercise-choice"
          data-testid="exercise-choice-input"
          value={choice}
          onChange={(event) => setChoice(event.currentTarget.value)}
          placeholder="Template_Choice"
          className="font-mono text-[0.9rem] normal-case tracking-normal"
        />
      </label>
      <JsonField
        id="exercise-choice-argument-json"
        label="Choice argument JSON"
        value={json}
        onChange={setJson}
        onValidityChange={setJsonValid}
      />
      {updateId === undefined ? null : <UpdateIdResult updateId={updateId} />}
      <PrimaryButton
        type="submit"
        className="w-full"
        data-testid="exercise-choice-submit"
        disabled={!canSubmit}
      >
        {busy ? 'Exercising...' : 'Exercise'}
      </PrimaryButton>
    </form>
  )
}
