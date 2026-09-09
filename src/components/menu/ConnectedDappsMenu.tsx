import { useState } from 'react'
import { PLAIN_ICON_BUTTON_CLASS } from '@/components/ui/Button'
import { DangerConfirm } from '@/components/ui/DangerConfirm'
import { DappIcon } from '@/components/ui/DappIcon'
import { DISCONNECT_ICON } from '@/components/ui/icons'
import { Sheet } from '@/components/ui/Sheet'
import { disconnectOrigin, faviconUrl } from '@/extension/runtimeClient'
import { useDirectConnectedOrigins } from '@/hooks/useDirectConnectedOrigins'
import { cn } from '@/utils/cn'

// One parse per origin: the host feeds the icon monogram, and the label keeps the whole origin
// minus an https prefix, so two origins on the same host do not read as the same row.
const describeOrigin = (origin: string): { host: string; label: string } => {
  try {
    const { host, protocol } = new URL(origin)
    return { host, label: protocol === 'https:' ? host : origin }
  } catch {
    return { host: origin, label: origin }
  }
}

// Every dApp connected through the injected provider, each one disconnectable on its own.
// The background answers a disconnect by telling that dApp before forgetting it.
export const ConnectedDappsMenu = (): JSX.Element | null => {
  const origins = useDirectConnectedOrigins(true)
  const [pendingOrigin, setPendingOrigin] = useState<string | undefined>(undefined)

  const disconnect = (): void => {
    const origin = pendingOrigin
    if (origin === undefined) {
      return
    }
    setPendingOrigin(undefined)
    disconnectOrigin(origin)
  }

  if (origins === undefined) {
    return null
  }

  if (origins.length === 0) {
    return (
      <p className="px-2 py-6 text-center text-[0.92rem] text-muted-foreground">
        No dApps connected
      </p>
    )
  }

  return (
    <>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {origins.map((origin) => {
          const { host, label } = describeOrigin(origin)
          return (
            <li
              key={origin}
              className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2.5"
            >
              <DappIcon
                host={host}
                icon={faviconUrl(origin)}
              />
              <span className="min-w-0 flex-1 truncate font-mono text-[0.86rem] text-foreground">
                {label}
              </span>
              <button
                type="button"
                data-testid="connected-dapp-disconnect"
                data-dapp-origin={origin}
                onClick={() => setPendingOrigin(origin)}
                aria-label={`Disconnect ${label}`}
                className={cn(PLAIN_ICON_BUTTON_CLASS, 'size-8 shrink-0 hover:text-danger')}
              >
                {DISCONNECT_ICON}
              </button>
            </li>
          )
        })}
      </ul>

      <Sheet
        open={pendingOrigin !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            setPendingOrigin(undefined)
          }
        }}
        testId="connected-dapp-disconnect-sheet"
        side="center"
        title={`Disconnect ${pendingOrigin === undefined ? '' : describeOrigin(pendingOrigin).label}?`}
        description="Disconnect this dApp from the wallet."
      >
        <DangerConfirm
          identifier={pendingOrigin}
          message="It will have to ask for a new connection to use this wallet again."
          confirmLabel="Disconnect"
          confirmTestId="connected-dapp-confirm-disconnect"
          onConfirm={disconnect}
        />
      </Sheet>
    </>
  )
}
