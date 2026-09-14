// The callback-style `chrome.runtime` surface, shared by the content script and the popup
// client. Both send a message and wait for one answer, and both have to keep working with no
// `chrome` at all: the wallet also runs as a plain web page.
//
// Declared here rather than imported from `@types/chrome` because the content script is bundled
// on its own and only ever touches these three members.

type RuntimeListener = (message: unknown) => void

export type ChromeRuntime = {
  lastError?: { message?: string }
  sendMessage?: (message: unknown, callback: (response?: unknown) => void) => void
  onMessage?: {
    addListener: (listener: RuntimeListener) => void
    removeListener?: (listener: RuntimeListener) => void
  }
}

// Read on every call, never cached: a content script is evaluated at `document_start`, and the
// popup's tests install their stub after this module is imported.
export const chromeRuntime = (): ChromeRuntime | undefined =>
  (globalThis as { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime

// Chrome reports a failed `sendMessage` on `runtime.lastError` inside the callback instead of
// throwing, and answers a message nobody handled with `undefined`, so both become rejections
// here and every caller can just await.
export const sendRuntimeMessage = async <T>(message: unknown): Promise<T> =>
  await new Promise<T>((resolve, reject) => {
    const api = chromeRuntime()
    if (api?.sendMessage === undefined) {
      reject(new Error('Carpincho extension runtime is not available'))
      return
    }
    api.sendMessage(message, (response) => {
      const lastError = api.lastError
      if (lastError !== undefined) {
        reject(new Error(lastError.message ?? 'Carpincho extension runtime failed'))
        return
      }
      if (response === undefined) {
        reject(new Error('Carpincho extension runtime returned no response'))
        return
      }
      resolve(response as T)
    })
  })
