import * as Avatar from '@radix-ui/react-avatar'
import { GLOBE_ICON } from '@/components/ui/icons'
import { cn } from '@/utils/cn'

const TILE = 'flex size-[26px] shrink-0 items-center justify-center overflow-hidden rounded-[7px]'

// dApp favicon via Radix Avatar (image with monogram fallback); the globe stands in
// when there is no site context to identify.
export const DappIcon = ({ host, icon }: { host?: string; icon?: string }): JSX.Element => {
  if (host === undefined) {
    return <span className={cn(TILE, 'bg-muted text-soft [&>svg]:size-[15px]')}>{GLOBE_ICON}</span>
  }
  return (
    <Avatar.Root className={cn(TILE, 'bg-muted')}>
      {icon !== undefined && (
        <Avatar.Image
          src={icon}
          alt=""
          className="size-full object-cover"
        />
      )}
      <Avatar.Fallback
        delayMs={icon === undefined ? undefined : 200}
        className="text-[0.8rem] font-bold text-muted-foreground"
      >
        {host.charAt(0).toUpperCase()}
      </Avatar.Fallback>
    </Avatar.Root>
  )
}
