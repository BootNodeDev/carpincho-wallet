import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { type DarUploadResponse, uploadDarFile } from '@/api/walletService'
import { PrimaryButton } from '@/components/ui/Button'
import { FileDropInput } from '@/components/ui/FileDropInput'
import { toast } from '@/components/ui/toast'

export interface DarUploadApi {
  uploadDarFile: (file: File) => Promise<DarUploadResponse>
}

interface DarUploadPanelProps {
  api?: DarUploadApi
}

const defaultApi: DarUploadApi = { uploadDarFile }

// Development-only utility for uploading compiled DAML archives through wallet-service.
export const DarUploadPanel = ({ api = defaultApi }: DarUploadPanelProps): JSX.Element => {
  const [file, setFile] = useState<File | undefined>()

  const upload = useMutation({
    mutationFn: async (selected: File) => {
      await api.uploadDarFile(selected)
      return selected.name
    },
    onSuccess: (name) => toast.success(`${name} uploaded`),
    onError: (error) => toast.error(error.message),
  })
  // The name of the file that landed, cleared while another upload is in flight.
  const uploadedFileName = upload.isPending ? undefined : upload.data

  // Keeps validation inside the dev-only upload utility.
  const onUpload = (): void => {
    if (file === undefined) {
      toast.warning('Select a DAR file')
      return
    }
    upload.mutate(file)
  }

  return (
    <section className="flex flex-col gap-4">
      <FileDropInput
        id="dar-file"
        testId="dar-file-input"
        accept=".dar,application/octet-stream"
        ariaLabel="DAR file"
        prompt="Click to choose a .dar file."
        fileName={file?.name ?? null}
        onSelect={(selected) => {
          // Dropping the last result must not drop an upload in flight: `reset` clears
          // `isPending` too, which would re-enable the button for a duplicate upload.
          if (!upload.isPending) {
            upload.reset()
          }
          setFile(selected ?? undefined)
        }}
      />
      <PrimaryButton
        className="w-full"
        data-testid="dar-upload-submit"
        disabled={file === undefined || upload.isPending}
        onClick={onUpload}
      >
        {upload.isPending ? 'Uploading...' : 'Upload'}
      </PrimaryButton>
      {uploadedFileName === undefined ? null : (
        <p
          role="status"
          className="text-center text-[0.9rem] font-semibold text-success"
        >
          {uploadedFileName} uploaded
        </p>
      )}
    </section>
  )
}
