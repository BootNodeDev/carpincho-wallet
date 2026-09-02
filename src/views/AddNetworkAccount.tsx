import { useEffect, useState } from 'react'
import { SecondaryButton } from '@/components/ui/Button'
import { toast } from '@/components/ui/toast'
import { WelcomeHero } from '@/components/WelcomeHero'
import { useNetwork } from '@/network/useNetwork'
import { ConnectionSettingsSheet } from '@/views/ConnectionSettingsSheet'
import { CreateFirstAccount } from '@/views/onboarding/CreateFirstAccount'

// Stands in for Home when the vault holds accounts but none the network in use hosts, which is
// an endpoint switch rather than a first run. It replaces Home, which owns the endpoint list,
// so it has to offer the way back to the other network itself.
export const AddNetworkAccount = (): JSX.Element => {
  const { networkId } = useNetwork()
  const [connectionOpen, setConnectionOpen] = useState(false)

  // Why the wallet landed here is feedback, not part of the form. Re-announced per network so
  // switching from this screen to another empty one says so again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  useEffect(() => {
    toast.info('No account on this network, please create one to proceed.')
  }, [networkId])

  return (
    <div>
      <WelcomeHero
        description="Canton development wallet."
        layout="compact"
      />
      <div className="flex flex-col gap-4">
        <CreateFirstAccount />
        <SecondaryButton
          className="w-full"
          data-testid="open-connection-settings"
          onClick={() => setConnectionOpen(true)}
        >
          Change endpoint
        </SecondaryButton>
        {/* Mounted on demand: closed, it would still read the config and probe the endpoints. */}
        {connectionOpen && (
          <ConnectionSettingsSheet
            open
            onOpenChange={setConnectionOpen}
          />
        )}
      </div>
    </div>
  )
}
