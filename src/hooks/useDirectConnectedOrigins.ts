import { useEffect, useState } from 'react'
import {
  getDirectConnectedOrigins,
  subscribeToDirectConnectedOrigins,
} from '@/extension/runtimeClient'

// Live list of the dApp origins connected through the injected provider, undefined until the
// first read lands. The subscription is installed before that read so a write arriving mid-read
// cannot be overwritten by it.
export const useDirectConnectedOrigins = (enabled: boolean): string[] | undefined => {
  const [origins, setOrigins] = useState<string[] | undefined>(undefined)

  useEffect(() => {
    if (!enabled) {
      return
    }
    let mounted = true
    let changed = false
    const unsubscribe = subscribeToDirectConnectedOrigins((next) => {
      changed = true
      if (mounted) {
        setOrigins(next)
      }
    })
    void getDirectConnectedOrigins()
      .catch((): string[] => [])
      .then((next) => {
        if (mounted && !changed) {
          setOrigins(next)
        }
      })
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [enabled])

  return origins
}
