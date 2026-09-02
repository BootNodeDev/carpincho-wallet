import { useState } from 'react'
import { EndpointForm } from '@/components/EndpointForm'
import { EndpointListRow } from '@/components/EndpointListRow'
import { AddRowButton } from '@/components/ui/AddRowButton'
import { DangerConfirm } from '@/components/ui/DangerConfirm'
import { SectionLabel } from '@/components/ui/SectionLabel'
import { Sheet } from '@/components/ui/Sheet'
import { toast } from '@/components/ui/toast'
import { newEndpointId, type WalletServiceEndpoint } from '@/config/runtimeConfig'
import { useRuntimeConfig } from '@/config/useRuntimeConfig'
import { useEndpointReachability } from '@/hooks/useEndpointReachability'

interface ConnectionSettingsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Wallet-service endpoints: a saved list plus in-place add and edit screens. The endpoint in use is
// the one every request reads, so picking a row is the whole switch.
export const ConnectionSettingsSheet = ({
  open,
  onOpenChange,
}: ConnectionSettingsSheetProps): JSX.Element => {
  const { config, saveConfig } = useRuntimeConfig()
  const [editing, setEditing] = useState<WalletServiceEndpoint | 'new' | null>(null)
  const [removeTarget, setRemoveTarget] = useState<WalletServiceEndpoint | null>(null)
  const reachability = useEndpointReachability(config.endpoints, open)

  const handleOpenChange = (next: boolean): void => {
    onOpenChange(next)
    if (!next) {
      setEditing(null)
      setRemoveTarget(null)
    }
  }

  const onSelect = (endpoint: WalletServiceEndpoint): void => {
    if (endpoint.id === config.activeEndpointId) {
      return
    }
    saveConfig({ ...config, activeEndpointId: endpoint.id })
    toast.success(`Now using ${endpoint.name}`)
  }

  const onSubmit = ({ name, url }: { name: string; url: string }): void => {
    const target = editing
    if (target === null) {
      return
    }
    saveConfig(
      target === 'new'
        ? {
            ...config,
            endpoints: [...config.endpoints, { id: newEndpointId(), name, url }],
          }
        : {
            ...config,
            endpoints: config.endpoints.map((endpoint) =>
              endpoint.id === target.id ? { ...endpoint, name, url } : endpoint,
            ),
          },
    )
    setEditing(null)
    toast.success(target === 'new' ? 'Endpoint added' : 'Endpoint saved')
  }

  const onConfirmRemove = (): void => {
    if (removeTarget === null) {
      return
    }
    const endpoints = config.endpoints.filter((endpoint) => endpoint.id !== removeTarget.id)
    // Removing the endpoint in use falls back to the first one left.
    saveConfig({ ...config, endpoints })
    setRemoveTarget(null)
    toast.success('Endpoint removed')
  }

  const title = (): string => {
    if (removeTarget !== null) {
      return `Remove ${removeTarget.name}?`
    }
    return editing === null ? 'Connection' : editing === 'new' ? 'Add endpoint' : editing.name
  }

  return (
    <Sheet
      open={open}
      onOpenChange={handleOpenChange}
      testId="connection-settings-sheet"
      // The confirm is a centered modal; the list and the forms stay a bottom sheet.
      side={removeTarget === null ? 'bottom' : 'center'}
      title={title()}
      description={
        removeTarget !== null
          ? 'Confirm removing this wallet-service endpoint.'
          : editing === null
            ? 'Pick, add, edit or remove wallet-service endpoints.'
            : 'Name the endpoint and test its RPC URL.'
      }
      onBack={editing === null || removeTarget !== null ? undefined : () => setEditing(null)}
      onClose={removeTarget === null ? undefined : () => setRemoveTarget(null)}
    >
      {removeTarget !== null ? (
        <DangerConfirm
          testId="remove-endpoint"
          identifier={removeTarget.url}
          message="This endpoint will no longer be available to pick."
          confirmLabel="Remove endpoint"
          confirmTestId="confirm-remove-endpoint"
          onConfirm={onConfirmRemove}
        />
      ) : editing === null ? (
        <div className="flex flex-col gap-2">
          <SectionLabel>Wallet-service endpoints</SectionLabel>
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
  )
}
