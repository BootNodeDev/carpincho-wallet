import { AccountRow } from '@/components/AccountRow'
import { CopyPartyIdButton } from '@/components/CopyPartyIdButton'
import { PLAIN_ICON_BUTTON_CLASS } from '@/components/ui/Button'
import { TRASH_ICON } from '@/components/ui/icons'
import { SelectableListRow } from '@/components/ui/SelectableListRow'
import { cn } from '@/utils/cn'
import type { AccountPublic } from '@/vault/types'

interface AccountListRowProps {
  account: AccountPublic
  canRemove: boolean
  onSelect: () => void
  onRequestRemove: () => void
}

// Remove is omitted when only one account exists.
export const AccountListRow = ({
  account,
  canRemove,
  onSelect,
  onRequestRemove,
}: AccountListRowProps): JSX.Element => (
  <SelectableListRow
    active={account.isPrimary}
    selectLabel={account.name}
    onSelect={onSelect}
    testId="account-item"
    rowData={{ 'data-party-id': account.partyId }}
    actions={
      canRemove && (
        <button
          type="button"
          data-testid="account-remove"
          data-party-id={account.partyId}
          onClick={onRequestRemove}
          aria-label={`Remove ${account.name}`}
          className={cn(PLAIN_ICON_BUTTON_CLASS, 'relative z-10 size-8 shrink-0 hover:text-danger')}
        >
          {TRASH_ICON}
        </button>
      )
    }
  >
    <AccountRow
      account={account}
      withName
      addressTrailing={<CopyPartyIdButton partyId={account.partyId} />}
    />
  </SelectableListRow>
)
