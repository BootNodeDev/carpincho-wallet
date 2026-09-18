import { PLAIN_ICON_BUTTON_CLASS } from '@/components/ui/Button'
import { DappIcon } from '@/components/ui/DappIcon'
import { CHEVRON_DOWN_ICON, DISCONNECT_ICON } from '@/components/ui/icons'
import { cn } from '@/utils/cn'
import { displayNetworkId } from '@/utils/network'

export interface ConnectionFooterStatus {
  connected: boolean
  networkId?: string
  reason?: string
}

export type DappFooterStatus =
  | { kind: 'none' }
  | { kind: 'detected' | 'connected'; host: string; subtitle: string; icon?: string }

interface ConnectionFooterProps {
  ledgerStatus: ConnectionFooterStatus
  dapp: DappFooterStatus
  onDisconnectDapp?: () => void
  onOpenSettings: () => void
}

// Single-row footer: dApp identity on the left, the network pill (settings + health) on the right.
export const ConnectionFooter = ({
  ledgerStatus,
  dapp,
  onDisconnectDapp,
  onOpenSettings,
}: ConnectionFooterProps): JSX.Element => {
  const networkLabel = ledgerStatus.connected
    ? (displayNetworkId(ledgerStatus.networkId) ?? 'unknown')
    : 'Offline'
  const site = dapp.kind === 'none' ? undefined : dapp
  const connected = dapp.kind === 'connected'

  return (
    <footer
      className={cn(
        // In-flow at the column bottom, bled past the shell padding to the popup edges.
        '-mx-3 shrink-0',
        'flex items-center gap-2.5 border-t border-border bg-background/95 px-3 py-2 backdrop-blur-md',
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <DappIcon
          host={site?.host}
          icon={site?.icon}
        />
        <div className="min-w-0 leading-tight">
          <div
            className={cn(
              'truncate text-[0.84rem] font-semibold',
              site === undefined ? 'text-muted-foreground' : 'font-mono text-foreground',
            )}
          >
            {site?.host ?? 'No dApp connected'}
          </div>
          {site !== undefined && (
            <div className="mt-0.5 flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  connected ? 'bg-success' : 'bg-border-strong',
                )}
              />
              <span
                className={cn(
                  'text-[0.72rem] font-semibold',
                  connected ? 'text-success' : 'text-muted-foreground',
                )}
              >
                {site.subtitle}
              </span>
              {connected && onDisconnectDapp !== undefined && (
                <button
                  type="button"
                  data-testid="footer-disconnect"
                  onClick={onDisconnectDapp}
                  aria-label="Disconnect"
                  title="Disconnect"
                  className={cn(
                    PLAIN_ICON_BUTTON_CLASS,
                    // size-6 is the 24px WCAG 2.5.8 floor; the glyph stays small so the
                    // footer row does not grow around it.
                    '-my-1 ml-0.5 size-6 text-soft hover:bg-danger/10 hover:text-danger [&>svg]:size-[13px]',
                  )}
                >
                  {DISCONNECT_ICON}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <button
        type="button"
        data-testid="connection-pill"
        onClick={onOpenSettings}
        aria-label="Connection settings"
        title={ledgerStatus.reason ?? 'Connection settings'}
        className={cn(
          'flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1.5',
          'text-[0.74rem] font-semibold transition-colors hover:border-border-strong',
          'focus-visible:outline-none focus-visible:shadow-focus',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'size-2 shrink-0 rounded-full',
            ledgerStatus.connected ? 'bg-success' : 'bg-danger',
          )}
        />
        <span className={ledgerStatus.connected ? 'text-foreground' : 'text-danger'}>
          {networkLabel}
        </span>
        <span className="text-soft [&>svg]:size-3.5">{CHEVRON_DOWN_ICON}</span>
      </button>
    </footer>
  )
}
