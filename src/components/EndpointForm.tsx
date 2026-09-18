import { useId, useState } from 'react'
import { GhostButton, PrimaryButton } from '@/components/ui/Button'
import { ALERT_CIRCLE_ICON, ALERT_TRIANGLE_ICON, SPINNER_ICON } from '@/components/ui/icons'
import { TextInput } from '@/components/ui/TextInput'
import { type GatewayEndpoint, isEndpointUrl, normalizeEndpointUrl } from '@/config/runtimeConfig'
import { useWalletServiceTest, type WalletServiceTestState } from '@/hooks/useWalletServiceTest'
import { cn } from '@/utils/cn'
import { displayNetworkId } from '@/utils/network'

const SUCCESS_DOT = (
  <span
    aria-hidden="true"
    className="block size-2 rounded-full bg-success"
  />
)

// Icon, colour and copy per outcome of the Test button; `connected` also renders the network id.
const RESULT: Record<
  Exclude<WalletServiceTestState, 'idle'>,
  (reason?: string) => { mark: JSX.Element; tone: string; text: string }
> = {
  testing: () => ({ mark: SPINNER_ICON, tone: 'text-soft', text: 'Testing…' }),
  connected: () => ({ mark: SUCCESS_DOT, tone: 'text-success', text: 'Reachable' }),
  'not-connected': (reason) => ({
    mark: ALERT_TRIANGLE_ICON,
    tone: 'text-warning',
    text: `Responded, Canton not connected${reason === undefined ? '' : `: ${reason}`}`,
  }),
  unreachable: (reason) => ({
    mark: ALERT_CIRCLE_ICON,
    tone: 'text-danger',
    text: reason ?? "Can't reach the gateway",
  }),
}

interface EndpointFormProps {
  // Omitted when adding a new endpoint.
  endpoint?: GatewayEndpoint
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
  const shown = result === undefined ? undefined : RESULT[result](reason)
  // Said only once there is something to judge, so it does not greet an empty field.
  const malformed = trimmedUrl !== '' && !isEndpointUrl(trimmedUrl)

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
          <label htmlFor={urlId}>Gateway URL</label>
          <GhostButton
            data-testid="endpoint-test"
            onClick={() => {
              void test(trimmedUrl)
            }}
            disabled={!isEndpointUrl(trimmedUrl) || state === 'testing'}
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
          onChange={(e) => setUrl(normalizeEndpointUrl(e.target.value))}
          placeholder="http://localhost:3010/rpc"
          error={malformed || result === 'unreachable'}
          aria-errormessage={malformed || result === 'unreachable' ? resultId : undefined}
        />
        {malformed && (
          <p
            id={resultId}
            role="status"
            className="mt-2 flex items-center gap-2 px-1 text-[0.82rem] font-semibold text-danger"
          >
            <span className="shrink-0 [&>svg]:size-4">{ALERT_CIRCLE_ICON}</span>
            <span className="min-w-0 font-normal">Enter a full http:// or https:// URL</span>
          </p>
        )}
        {!malformed && shown !== undefined && (
          <p
            id={resultId}
            role="status"
            className={cn(
              'mt-2 flex items-center gap-2 px-1 text-[0.82rem] font-semibold',
              shown.tone,
            )}
          >
            <span className="shrink-0 [&>svg]:size-4">{shown.mark}</span>
            <span className="min-w-0 truncate font-normal">{shown.text}</span>
            {result === 'connected' && network !== undefined && (
              <span className="truncate font-mono text-[0.78rem] font-normal text-muted-foreground">
                {network}
              </span>
            )}
          </p>
        )}
      </div>

      <PrimaryButton
        type="submit"
        className="mt-1 w-full"
        data-testid="endpoint-save"
        disabled={trimmedName === '' || !isEndpointUrl(trimmedUrl)}
      >
        {submitLabel}
      </PrimaryButton>
    </form>
  )
}
