import type { MenuListRow, Screen } from '@/components/menu/screens'
import { MenuRow } from '@/components/ui/MenuRow'

export const MENU_LIST_CLASS = 'flex flex-col gap-2 list-none m-0 p-0'

interface MenuListProps {
  rows: MenuListRow[]
  onNavigate: (screen: Screen) => void
  onLock: () => void
}

export const MenuList = ({ rows, onNavigate, onLock }: MenuListProps): JSX.Element => (
  <ul className={MENU_LIST_CLASS}>
    {rows.map(({ label, to, tone, icon }) => (
      <MenuRow
        key={label}
        label={label}
        tone={tone}
        icon={icon}
        testId={`menu-row-${to}`}
        onClick={to === 'lock' ? onLock : () => onNavigate(to)}
      />
    ))}
  </ul>
)
