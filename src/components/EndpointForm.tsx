import { useId, useState } from 'react'
import { GhostButton, PrimaryButton } from '@/components/ui/Button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/Collapsible'
import {
  ALERT_CIRCLE_ICON,
  ALERT_TRIANGLE_ICON,
  CHEVRON_DOWN_ICON,
  SPINNER_ICON,
} from '@/components/ui/icons'
import { TextInput } from '@/components/ui/TextInput'
import {
  DEFAULT_CLIENT_SECRET,
  DEFAULT_REGISTRY_URL,
  DEFAULT_SCAN_API_URL,
  DEFAULT_VALIDATOR_URL,
  type GatewayEndpoint,
  isEndpointUrl,
  normalizeEndpointUrl,
} from '@/config/runtimeConfig'
import { type EndpointTestState, useEndpointTest } from '@/hooks/useEndpointTest'
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
  Exclude<EndpointTestState, 'idle'>,
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

// Everything an endpoint holds. Blank means "use the default", which is what the config
// sanitizer reads an empty string as, so nothing here has to decide that a second time.
export interface EndpointFormValues {
  name: string
  url: string
  networkId: string
  clientSecret: string
  validatorUrl: string
  scanApiUrl: string
  registryUrl: string
}

interface EndpointFormProps {
  // Omitted when adding a new endpoint.
  endpoint?: GatewayEndpoint
  submitLabel: string
  onSubmit: (values: EndpointFormValues) => void
}

// One optional field of the Advanced section: blank falls back to what the placeholder names.
const AdvancedField = ({
  label,
  testId,
  value,
  onChange,
  placeholder,
}: {
  label: string
  testId: string
  value: string
  onChange: (next: string) => void
  placeholder: string
}): JSX.Element => {
  const id = useId()
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <TextInput
        id={id}
        data-testid={testId}
        className="font-mono"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  )
}

// Name + gateway URL + Test, shared by the add and edit screens of the Connection sheet. The
// rest of an endpoint sits behind Advanced: a LocalNet gateway needs none of it, and a remote
// one cannot work without it.
export const EndpointForm = ({
  endpoint,
  submitLabel,
  onSubmit,
}: EndpointFormProps): JSX.Element => {
  const [name, setName] = useState(endpoint?.name ?? '')
  const [url, setUrl] = useState(endpoint?.url ?? '')
  const [networkInput, setNetworkInput] = useState(endpoint?.networkId ?? '')
  const [secret, setSecret] = useState(endpoint?.clientSecret ?? '')
  const [validator, setValidator] = useState(endpoint?.validatorUrl ?? '')
  const [scan, setScan] = useState(endpoint?.scanApiUrl ?? '')
  const [registry, setRegistry] = useState(endpoint?.registryUrl ?? '')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const nameId = useId()
  const urlId = useId()
  const resultId = useId()
  const { state, networkId, reason, testedUrl, test } = useEndpointTest()

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
        onSubmit({
          name: trimmedName,
          url: trimmedUrl,
          networkId: networkInput.trim(),
          clientSecret: secret.trim(),
          validatorUrl: normalizeEndpointUrl(validator),
          scanApiUrl: normalizeEndpointUrl(scan),
          registryUrl: normalizeEndpointUrl(registry),
        })
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
          placeholder="http://localhost:3030/api/v0/user"
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

      <Collapsible
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
      >
        <CollapsibleTrigger
          testId="endpoint-advanced"
          className="justify-between text-[0.82rem] font-semibold text-muted-foreground"
        >
          Advanced
          <span
            aria-hidden="true"
            className={cn('transition-transform [&>svg]:size-4', advancedOpen && 'rotate-180')}
          >
            {CHEVRON_DOWN_ICON}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-4 pt-4">
          <AdvancedField
            label="Network ID"
            testId="endpoint-network-input"
            value={networkInput}
            onChange={setNetworkInput}
            placeholder="the gateway's only network"
          />
          <AdvancedField
            label="Client secret"
            testId="endpoint-secret-input"
            value={secret}
            onChange={setSecret}
            placeholder={DEFAULT_CLIENT_SECRET}
          />
          <AdvancedField
            label="Validator URL"
            testId="endpoint-validator-input"
            value={validator}
            onChange={setValidator}
            placeholder={DEFAULT_VALIDATOR_URL}
          />
          <AdvancedField
            label="Scan API URL"
            testId="endpoint-scan-input"
            value={scan}
            onChange={setScan}
            placeholder={DEFAULT_SCAN_API_URL}
          />
          <AdvancedField
            label="Registry URL"
            testId="endpoint-registry-input"
            value={registry}
            onChange={setRegistry}
            placeholder={DEFAULT_REGISTRY_URL}
          />
        </CollapsibleContent>
      </Collapsible>

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
