import type {
  CANTON_ANNOUNCE_PROVIDER_EVENT as SdkAnnounceEvent,
  CANTON_REQUEST_PROVIDER_EVENT as SdkRequestEvent,
} from '@canton-network/core-types'
import { CARPINCHO_PROVIDER_ID, CARPINCHO_PROVIDER_NAME } from '@/extension/messages'

// Typed by the SDK's own constants, so a rename upstream fails the build here.
export const CANTON_REQUEST_PROVIDER_EVENT: typeof SdkRequestEvent = 'canton:requestProvider'
export const CANTON_ANNOUNCE_PROVIDER_EVENT: typeof SdkAnnounceEvent = 'canton:announceProvider'

// Who the wallet says it is, as carried by the `canton:announceProvider` detail. A function
// rather than a shared const: the detail is handed to whichever page listener asked, so each
// announcement gets its own object and no listener can edit what a later one carries.
export const announcedProvider = () => ({
  id: CARPINCHO_PROVIDER_ID,
  name: CARPINCHO_PROVIDER_NAME,
  description: 'Connect with the Carpincho browser extension wallet',
  target: CARPINCHO_PROVIDER_ID,
  // A base64 data URI built from icons/carpincho-48.png at build time: the SDK types this field
  // as a data or https URL, and its picker renders in a blob: document that cannot load an
  // extension URL.
  icon: __WALLET_ICON_DATA_URL__,
})
