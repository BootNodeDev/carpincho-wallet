import { useState } from 'react'
import { Alert } from '@/components/ui/Alert'
import { SecondaryButton } from '@/components/ui/Button'
import { Stepper } from '@/components/ui/Stepper'
import { WelcomeHero } from '@/components/WelcomeHero'
import { offNetworkAccountsNote } from '@/utils/account'
import { useVault } from '@/vault/useVault'
import { ConnectionSettingsSheet } from '@/views/ConnectionSettingsSheet'
import { ConfigureRpcStep } from '@/views/onboarding/ConfigureRpcStep'
import { CreateFirstAccount } from '@/views/onboarding/CreateFirstAccount'
import { CreateVault } from '@/views/onboarding/CreateVault'

const ONBOARDING_STEPS = ['Vault', 'RPC', 'Account']

export const OnboardingFlow = (): JSX.Element => {
  const v = useVault()
  // In-memory gate: the RPC step re-shows on reload (no persisted onboarding state).
  const [rpcConfirmed, setRpcConfirmed] = useState(false)
  const [connectionOpen, setConnectionOpen] = useState(false)
  // A vault holding accounts for other networks is not a first run: the user switched to a
  // network they have no account on. The endpoint is already configured, so the stepper and
  // its RPC step would only be in the way of the one thing left to do. This view replaces
  // Home, which owns the endpoint list, so it has to offer the way back itself.
  const needsAccountForNetwork = v.offNetworkCount > 0
  const step = !v.hasVault ? 1 : !rpcConfirmed ? 2 : 3

  return (
    <div>
      <WelcomeHero
        description="Canton development wallet."
        layout="compact"
      />
      {needsAccountForNetwork ? (
        <div className="flex flex-col gap-4">
          <Alert
            variant="info"
            testId="onboarding-no-account-here"
          >
            No account on this network. {offNetworkAccountsNote(v.offNetworkCount)}
          </Alert>
          <CreateFirstAccount />
          <SecondaryButton
            className="w-full"
            data-testid="onboarding-open-connection"
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
      ) : (
        <>
          <Stepper
            steps={ONBOARDING_STEPS}
            current={step}
          />
          <div
            key={step}
            className="animate-slide-up-and-fade [animation-fill-mode:backwards]"
          >
            {step === 1 && <CreateVault />}
            {step === 2 && <ConfigureRpcStep onConfirmed={() => setRpcConfirmed(true)} />}
            {step === 3 && <CreateFirstAccount />}
          </div>
        </>
      )}
    </div>
  )
}
