import { PLAIN_ICON_BUTTON_CLASS } from '@/components/ui/Button'
import { CHECK_ICON, PENCIL_ICON, TRASH_ICON } from '@/components/ui/icons'
import type { WalletServiceEndpoint } from '@/config/runtimeConfig'
import type { Reachability } from '@/hooks/useEndpointReachability'
import { cn } from '@/utils/cn'

const DOT_CLASS: Record<Reachability, string> = {
  checking: 'bg-muted-foreground/40',
  reachable: 'bg-success',
  unreachable: 'bg-muted-foreground/40',
}

const DOT_LABEL: Record<Reachability, string> = {
  checking: 'Checking',
  reachable: 'Reachable',
  unreachable: 'Unreachable',
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

// A full-row button picks the endpoint; the pencil and trash buttons sit above it so their clicks
// stay independent of selection. Remove is omitted when only one endpoint is saved.
export const EndpointListRow = ({
  endpoint,
  active,
  reachability,
  canRemove,
  onSelect,
  onRequestEdit,
  onRequestRemove,
}: EndpointListRowProps): JSX.Element => (
  <div
    className={cn(
      'group/row relative flex w-full items-center gap-1 rounded-md border border-border bg-surface transition-colors',
      active && 'border-primary/60 bg-primary-soft/40',
    )}
  >
    <button
      type="button"
      data-testid="endpoint-item"
      data-endpoint-name={endpoint.name}
      aria-current={active ? true : undefined}
      aria-label={`Use ${endpoint.name}`}
      onClick={onSelect}
      className="absolute inset-0 z-0 rounded-md outline-none transition-colors group-hover/row:bg-primary-soft focus-visible:shadow-focus"
    />
    <div className="pointer-events-none relative z-10 flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5">
      <span
        title={DOT_LABEL[reachability]}
        className={cn('size-2 shrink-0 rounded-full', DOT_CLASS[reachability])}
      >
        <span className="sr-only">{DOT_LABEL[reachability]}</span>
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-semibold text-foreground">{endpoint.name}</span>
        <span className="truncate font-mono text-[0.76rem] text-muted-foreground">
          {endpoint.url}
        </span>
      </span>
    </div>
    {active && (
      <span className="pointer-events-none relative z-10 shrink-0 text-primary">{CHECK_ICON}</span>
    )}
    <button
      type="button"
      data-testid="endpoint-edit"
      onClick={onRequestEdit}
      aria-label={`Edit ${endpoint.name}`}
      className={cn(PLAIN_ICON_BUTTON_CLASS, 'relative z-10 size-8 shrink-0')}
    >
      {PENCIL_ICON}
    </button>
    {canRemove && (
      <button
        type="button"
        data-testid="endpoint-remove"
        onClick={onRequestRemove}
        aria-label={`Remove ${endpoint.name}`}
        className={cn(
          PLAIN_ICON_BUTTON_CLASS,
          'relative z-10 mr-1 size-8 shrink-0 hover:text-danger',
        )}
      >
        {TRASH_ICON}
      </button>
    )}
  </div>
)
