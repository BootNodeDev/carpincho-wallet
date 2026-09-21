import { useState } from 'react'
import { Stepper } from '@/components/ui/Stepper'
import { WelcomeHero } from '@/components/WelcomeHero'
import { useVault } from '@/vault/useVault'
import { ConfigureGatewayStep } from '@/views/onboarding/ConfigureGatewayStep'
import { CreateFirstAccount } from '@/views/onboarding/CreateFirstAccount'
import { CreateVault } from '@/views/onboarding/CreateVault'

const ONBOARDING_STEPS = ['Vault', 'Gateway', 'Account']

export const OnboardingFlow = (): JSX.Element => {
  const v = useVault()
  // In-memory gate: the gateway step re-shows on reload (no persisted onboarding state).
  const [gatewayConfirmed, setGatewayConfirmed] = useState(false)
  const step = !v.hasVault ? 1 : !gatewayConfirmed ? 2 : 3

  return (
    <main>
      <WelcomeHero
        description="Canton development wallet."
        layout="compact"
      />
      <Stepper
        steps={ONBOARDING_STEPS}
        current={step}
      />
      <div
        key={step}
        className="animate-slide-up-and-fade [animation-fill-mode:backwards]"
      >
        {step === 1 && <CreateVault />}
        {step === 2 && <ConfigureGatewayStep onConfirmed={() => setGatewayConfirmed(true)} />}
        {step === 3 && <CreateFirstAccount />}
      </div>
    </main>
  )
}
