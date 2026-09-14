import { PLAIN_ICON_BUTTON_CLASS } from '@/components/ui/Button'
import { CHECK_ICON, PENCIL_ICON, TRASH_ICON } from '@/components/ui/icons'
import { SelectableListRow } from '@/components/ui/SelectableListRow'
import type { WalletServiceEndpoint } from '@/config/runtimeConfig'
import type { Reachability } from '@/hooks/useEndpointReachability'
import { cn } from '@/utils/cn'

// A probe in flight pulses, so "still checking" never looks like "down".
const DOT: Record<Reachability, { className: string; label: string }> = {
  checking: { className: 'bg-muted-foreground/40 animate-soft-pulse', label: 'Checking' },
  reachable: { className: 'bg-success', label: 'Reachable' },
  'not-connected': { className: 'bg-warning', label: 'Responded, Canton not connected' },
  unreachable: { className: 'bg-muted-foreground/40', label: 'Unreachable' },
}

interface EndpointListRowProps {
  endpoint: WalletServiceEndpoint
  active: boolean
  reachability: Reachability
  canRemove: boolean
  onSelect: () => void
  onRequestEdit: () => void
  onRequestRemove: () => void
}

// Remove is omitted when only one endpoint is saved.
export const EndpointListRow = ({
  endpoint,
  active,
  reachability,
  canRemove,
  onSelect,
  onRequestEdit,
  onRequestRemove,
}: EndpointListRowProps): JSX.Element => {
  const dot = DOT[reachability]
  const actionClass = cn(PLAIN_ICON_BUTTON_CLASS, 'relative z-10 size-8 shrink-0')

  return (
    <SelectableListRow
      active={active}
      selectLabel={`Use ${endpoint.name}`}
      onSelect={onSelect}
      testId="endpoint-item"
      rowData={{ 'data-endpoint-name': endpoint.name }}
      actions={
        <>
          {active && (
            <span className="pointer-events-none relative z-10 shrink-0 text-primary-text">
              {CHECK_ICON}
            </span>
          )}
          <button
            type="button"
            data-testid="endpoint-edit"
            data-endpoint-name={endpoint.name}
            onClick={onRequestEdit}
            aria-label={`Edit ${endpoint.name}`}
            className={actionClass}
          >
            {PENCIL_ICON}
          </button>
          {canRemove && (
            <button
              type="button"
              data-testid="endpoint-remove"
              data-endpoint-name={endpoint.name}
              onClick={onRequestRemove}
              aria-label={`Remove ${endpoint.name}`}
              className={cn(actionClass, 'mr-1 hover:text-danger')}
            >
              {TRASH_ICON}
            </button>
          )}
        </>
      }
    >
      <span className={cn('size-2 shrink-0 rounded-full', dot.className)}>
        <span className="sr-only">{dot.label}</span>
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-semibold text-foreground">{endpoint.name}</span>
        <span className="truncate font-mono text-[0.76rem] text-muted-foreground">
          {endpoint.url}
        </span>
      </span>
    </SelectableListRow>
  )
}
