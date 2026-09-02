import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'

interface SelectableListRowProps {
  active: boolean
  // Accessible name of the full-row select button.
  selectLabel: string
  onSelect: () => void
  testId: string
  // data-* attributes for the select button; rows sharing one testid need a discriminator.
  rowData?: Record<string, string>
  children: ReactNode
  // Icon buttons that keep their own click target, laid out after the content.
  actions?: ReactNode
}

// List row where the whole row is one select button and the trailing actions sit above it, so an
// action click never selects the row. Shared by the account switcher and the endpoint list.
export const SelectableListRow = ({
  active,
  selectLabel,
  onSelect,
  testId,
  rowData,
  children,
  actions,
}: SelectableListRowProps): JSX.Element => (
  <div
    className={cn(
      'group/row relative flex w-full items-center gap-1 rounded-md border border-border bg-surface transition-colors',
      active && 'border-primary/60 bg-primary-soft/40',
    )}
  >
    <button
      type="button"
      data-testid={testId}
      {...rowData}
      aria-current={active ? true : undefined}
      aria-label={selectLabel}
      onClick={onSelect}
      className="absolute inset-0 z-0 rounded-md outline-none transition-colors group-hover/row:bg-primary-soft focus-visible:shadow-focus"
    />
    <div className="pointer-events-none relative z-10 flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5">
      {children}
    </div>
    {actions}
  </div>
)
