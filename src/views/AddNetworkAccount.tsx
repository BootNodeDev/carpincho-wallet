import { useState } from 'react'
import { Alert } from '@/components/ui/Alert'
import { SecondaryButton } from '@/components/ui/Button'
import { WelcomeHero } from '@/components/WelcomeHero'
import { ConnectionSettingsSheet } from '@/views/ConnectionSettingsSheet'
import { CreateFirstAccount } from '@/views/onboarding/CreateFirstAccount'

// Stands in for Home when the vault holds accounts but none the network in use hosts, which is
// an endpoint switch rather than a first run. It replaces Home, which owns the endpoint list,
// so it has to offer the way back to the other network itself.
export const AddNetworkAccount = (): JSX.Element => {
  const [connectionOpen, setConnectionOpen] = useState(false)

  return (
    <div>
      <WelcomeHero
        description="Canton development wallet."
        layout="compact"
      />
      <div className="flex flex-col gap-4">
        <Alert
          variant="info"
          testId="no-account-for-network"
        >
          No parties on this network, please create one to proceed.
        </Alert>
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
