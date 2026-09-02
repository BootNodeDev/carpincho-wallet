import { useId, useState } from 'react'
import { GhostButton, PrimaryButton } from '@/components/ui/Button'
import { ALERT_CIRCLE_ICON, ALERT_TRIANGLE_ICON, SPINNER_ICON } from '@/components/ui/icons'
import { TextInput } from '@/components/ui/TextInput'
import type { WalletServiceEndpoint } from '@/config/runtimeConfig'
import { useWalletServiceTest } from '@/hooks/useWalletServiceTest'
import { displayNetworkId } from '@/utils/network'

interface EndpointFormProps {
  // Omitted when adding a new endpoint.
  endpoint?: WalletServiceEndpoint
  submitLabel: string
  onSubmit: (values: { name: string; url: string }) => void
}

// Name + RPC URL + Test, shared by the add and edit screens of the Connection sheet.
export const EndpointForm = ({
  endpoint,
  submitLabel,
  onSubmit,
}: EndpointFormProps): JSX.Element => {
  const [name, setName] = useState(endpoint?.name ?? '')
  const [url, setUrl] = useState(endpoint?.url ?? '')
  const nameId = useId()
  const urlId = useId()
  const resultId = useId()
  const { state, networkId, reason, testedUrl, test } = useWalletServiceTest()

  const trimmedName = name.trim()
  const trimmedUrl = url.trim()
  // The result belongs to the URL it was measured against, so an edit hides it again.
  const result = testedUrl === trimmedUrl && state !== 'idle' ? state : undefined
  const network = displayNetworkId(networkId)

  return (
    <form
      className="flex flex-col gap-4 pt-1"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit({ name: trimmedName, url: trimmedUrl })
      }}
    >
      <div>
        <label htmlFor={nameId}>Name</label>
        <TextInput
          id={nameId}
          data-testid="endpoint-name-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Devnet"
        />
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={urlId}>RPC URL</label>
          <GhostButton
            data-testid="endpoint-test"
            onClick={() => {
              void test(trimmedUrl)
            }}
            disabled={trimmedUrl === '' || state === 'testing'}
            className="text-[0.82rem]"
          >
            Test
          </GhostButton>
        </div>
        <TextInput
          id={urlId}
          data-testid="endpoint-url-input"
          type="url"
          className="font-mono"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://localhost:3010/rpc"
          error={result === 'unreachable'}
          aria-errormessage={result === 'unreachable' ? resultId : undefined}
        />
        {result !== undefined && (
          <p
            id={resultId}
            role="status"
            className="mt-2 flex items-center gap-2 px-1 text-[0.82rem] font-semibold"
          >
            {result === 'testing' && (
              <>
                <span className="shrink-0 text-soft [&>svg]:size-4">{SPINNER_ICON}</span>
                <span className="text-soft">Testing…</span>
              </>
            )}
            {result === 'connected' && (
              <>
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full bg-success"
                />
                <span className="text-success">Reachable</span>
                {network !== undefined && (
                  <span className="truncate font-mono text-[0.78rem] font-normal text-muted-foreground">
                    {network}
                  </span>
                )}
              </>
            )}
            {result === 'not-connected' && (
              <>
                <span className="shrink-0 text-warning [&>svg]:size-4">{ALERT_TRIANGLE_ICON}</span>
                <span className="min-w-0 truncate font-normal text-warning">
                  Responded, Canton not connected{reason === undefined ? '' : `: ${reason}`}
                </span>
              </>
            )}
            {result === 'unreachable' && (
              <>
                <span className="shrink-0 text-danger [&>svg]:size-4">{ALERT_CIRCLE_ICON}</span>
                <span className="min-w-0 truncate font-normal text-danger">
                  {reason ?? "Can't reach wallet-service"}
                </span>
              </>
            )}
          </p>
        )}
      </div>

      <PrimaryButton
        type="submit"
        className="mt-1 w-full"
        data-testid="endpoint-save"
        disabled={trimmedName === '' || trimmedUrl === ''}
      >
        {submitLabel}
      </PrimaryButton>
    </form>
  )
}
