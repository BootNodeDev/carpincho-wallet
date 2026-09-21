import { strict as assert } from 'node:assert'
import { afterEach, describe, it } from 'node:test'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DarUploadPanel } from '@/components/DarUploadPanel'
import { toast } from '@/components/ui/toast'
import { TestQueryClientProvider } from '@/test-utils/queryClient'

describe('DarUploadPanel', () => {
  afterEach(() => {
    // The panel owns transient upload state; cleanup resets the DOM between scenarios.
    cleanup()
    toast.clear()
  })

  it('uploads the selected DAR through the provided API', async () => {
    // Scenario: a developer selects one compiled DAR and submits it to the
    // participant's package upload endpoint.
    const selectedFile = new File(['dar-bytes'], 'token.dar')
    let uploaded: File | undefined

    render(
      <DarUploadPanel
        api={{
          uploadDarFile: async (file) => {
            uploaded = file
            return { ok: true, vetAllPackages: true, response: {} }
          },
        }}
      />,
      { wrapper: TestQueryClientProvider },
    )

    await userEvent.upload(screen.getByLabelText('DAR file'), selectedFile)
    await userEvent.click(screen.getByRole('button', { name: 'Upload' }))

    // The exact selected file object is passed through, preserving binary contents and filename.
    assert.equal(uploaded, selectedFile)
    await screen.findByText('token.dar uploaded')
  })

  it('stays disabled when another file is picked mid-upload', async () => {
    // Scenario: picking a second DAR while the first is still uploading must not re-enable
    // the button, or the same archive could be pushed twice.
    let calls = 0
    let finishUpload: (() => void) | undefined

    render(
      <DarUploadPanel
        api={{
          uploadDarFile: async () => {
            calls += 1
            await new Promise<void>((resolve) => {
              finishUpload = resolve
            })
            return { ok: true, vetAllPackages: true, response: {} }
          },
        }}
      />,
      { wrapper: TestQueryClientProvider },
    )

    const input = screen.getByLabelText('DAR file')
    const submit = screen.getByTestId('dar-upload-submit') as HTMLButtonElement
    await userEvent.upload(input, new File(['first'], 'first.dar'))
    await userEvent.click(submit)
    await screen.findByText('Uploading...')

    await userEvent.upload(input, new File(['second'], 'second.dar'))
    assert.equal(submit.disabled, true)

    finishUpload?.()
    await screen.findByText('first.dar uploaded')
    assert.equal(calls, 1)
  })
})
