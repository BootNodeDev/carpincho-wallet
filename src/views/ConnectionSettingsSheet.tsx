import { useState } from 'react'
import { EndpointForm } from '@/components/EndpointForm'
import { EndpointListRow } from '@/components/EndpointListRow'
import { AddRowButton } from '@/components/ui/AddRowButton'
import { DangerConfirm } from '@/components/ui/DangerConfirm'
import { SectionLabel } from '@/components/ui/SectionLabel'
import { Sheet } from '@/components/ui/Sheet'
import { toast } from '@/components/ui/toast'
import { type GatewayEndpoint, newEndpointId } from '@/config/runtimeConfig'
import { useRuntimeConfig } from '@/config/useRuntimeConfig'
import { useEndpointReachability } from '@/hooks/useEndpointReachability'

interface ConnectionSettingsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Gateway endpoints: a saved list plus in-place add and edit screens. The endpoint in use is
// the one every request reads, so picking a row is the whole switch.
export const ConnectionSettingsSheet = ({
  open,
  onOpenChange,
}: ConnectionSettingsSheetProps): JSX.Element => {
  const { config, saveConfig } = useRuntimeConfig()
  const [editing, setEditing] = useState<GatewayEndpoint | 'new' | null>(null)
  const [removeTarget, setRemoveTarget] = useState<GatewayEndpoint | null>(null)
  const reachability = useEndpointReachability(config.endpoints)

  const handleOpenChange = (next: boolean): void => {
    onOpenChange(next)
    if (!next) {
      setEditing(null)
      setRemoveTarget(null)
    }
  }

  // Picking a row is the whole switch, so the sheet has nothing left to do either way.
  const onSelect = (endpoint: GatewayEndpoint): void => {
    if (endpoint.id !== config.activeEndpointId) {
      saveConfig({ ...config, activeEndpointId: endpoint.id })
      toast.success(`Now using ${endpoint.name}`)
    }
    handleOpenChange(false)
  }

  const onSubmit = ({ name, url }: { name: string; url: string }): void => {
    const target = editing
    if (target === null) {
      return
    }
    const endpoints =
      target === 'new'
        ? [...config.endpoints, { id: newEndpointId(), name, url }]
        : config.endpoints.map((endpoint) =>
            endpoint.id === target.id ? { ...endpoint, name, url } : endpoint,
          )
    saveConfig({ ...config, endpoints })
    setEditing(null)
    toast.success(target === 'new' ? 'Endpoint added' : 'Endpoint saved')
  }

  const onConfirmRemove = (): void => {
    if (removeTarget === null) {
      return
    }
    const endpoints = config.endpoints.filter((endpoint) => endpoint.id !== removeTarget.id)
    const active = endpoints.find((endpoint) => endpoint.id === config.activeEndpointId)
    // Removing the endpoint in use hands over to the first one left.
    saveConfig({ endpoints, activeEndpointId: (active ?? endpoints[0]).id })
    setRemoveTarget(null)
    toast.success('Endpoint removed')
  }

  return (
    <>
      <Sheet
        // The confirm takes over the screen, so this one steps aside while it is up.
        open={open && removeTarget === null}
        onOpenChange={handleOpenChange}
        testId="connection-settings-sheet"
        title={editing === null ? 'Connection' : editing === 'new' ? 'Add endpoint' : editing.name}
        description={
          editing === null
            ? 'Pick, add, edit or remove Wallet Gateway endpoints.'
            : 'Name the endpoint and test its gateway URL.'
        }
        onBack={editing === null ? undefined : () => setEditing(null)}
      >
        {editing === null ? (
          <div className="flex flex-col gap-2">
            <SectionLabel>Gateway endpoints</SectionLabel>
            {config.endpoints.map((endpoint) => (
              <EndpointListRow
                key={endpoint.id}
                endpoint={endpoint}
                active={endpoint.id === config.activeEndpointId}
                reachability={reachability[endpoint.id] ?? 'checking'}
                canRemove={config.endpoints.length > 1}
                onSelect={() => onSelect(endpoint)}
                onRequestEdit={() => setEditing(endpoint)}
                onRequestRemove={() => setRemoveTarget(endpoint)}
              />
            ))}
            <AddRowButton
              label="Add endpoint"
              testId="endpoint-add"
              onClick={() => setEditing('new')}
            />
          </div>
        ) : (
          <EndpointForm
            endpoint={editing === 'new' ? undefined : editing}
            submitLabel="Save"
            onSubmit={onSubmit}
          />
        )}
      </Sheet>

      <Sheet
        open={removeTarget !== null}
        onOpenChange={(next) => {
          if (!next) {
            setRemoveTarget(null)
          }
        }}
        testId="endpoint-remove-sheet"
        side="center"
        title={`Remove ${removeTarget?.name ?? 'endpoint'}?`}
        description="Confirm removing this gateway endpoint."
      >
        <DangerConfirm
          testId="remove-endpoint"
          identifier={removeTarget?.url}
          confirmLabel="Remove endpoint"
          confirmTestId="confirm-remove-endpoint"
          onConfirm={onConfirmRemove}
        />
      </Sheet>
    </>
  )
}
