import { useEffect, useState } from 'react'
import { ConnectionFooter } from '@/components/ConnectionFooter'
import { CreateAccountForm } from '@/components/CreateAccountForm'
import { Card } from '@/components/ui/Card'
import { toast } from '@/components/ui/toast'
import { WelcomeHero } from '@/components/WelcomeHero'
import { useExtensionDappConnection } from '@/extension/dappConnection'
import { isExtensionRuntime } from '@/extension/runtimeClient'
import { useNetwork } from '@/network/useNetwork'
import { ConnectionSettingsSheet } from '@/views/ConnectionSettingsSheet'
import type { ConnectedDappSession } from '@/wc/client'

// No WalletConnect lifecycle runs on this screen, so the footer's dApp row reports only what
// the extension runtime can see, and offers no disconnect.
const NO_SESSIONS: ConnectedDappSession[] = []

// Stands in for Home when the vault holds accounts but none the network in use hosts, which is
// an endpoint switch rather than a first run. It keeps the footer, so picking another endpoint
// is the way out of here and it is the same control as on Home.
export const AddNetworkAccount = (): JSX.Element => {
  const walletService = useNetwork()
  const [connectionOpen, setConnectionOpen] = useState(false)
  const dapp = useExtensionDappConnection({
    extensionMode: isExtensionRuntime(),
    sessions: NO_SESSIONS,
  })

  // Why the wallet landed here is feedback, not part of the form. Re-announced per network so
  // switching from this screen to another empty one says so again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  useEffect(() => {
    toast.info('No account on this network, please create one to proceed.')
  }, [walletService.networkId])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <WelcomeHero
          description="Canton development wallet."
          layout="compact"
        />
        {/* Create only, no restore tab: the vault already holds accounts, so its own backup
            would import nothing here — every entry is a party-and-network duplicate. Restore
            stays in the drawer, and in first-run onboarding where the vault is empty. */}
        <Card>
          <CreateAccountForm />
        </Card>
      </div>

      <ConnectionFooter
        walletService={walletService}
        dapp={dapp}
        onOpenSettings={() => setConnectionOpen(true)}
      />

      {/* Mounted on demand: closed, it would still read the config and probe the endpoints. */}
      {connectionOpen && (
        <ConnectionSettingsSheet
          open
          onOpenChange={setConnectionOpen}
        />
      )}
    </div>
  )
}
