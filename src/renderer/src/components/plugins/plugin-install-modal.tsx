import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button } from '@heroui/react'
import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@renderer/components/base/toast'
import { previewPlugin, installPlugin } from '@renderer/utils/ipc'

interface Props {
  onClose: () => void
  initialFile?: File // dropped file: auto-load + preview on open
}

const MAX_CPX_BYTES = 10 * 1024 * 1024 // guard against a huge mis-dropped file freezing the renderer

function abToBase64(buf: ArrayBuffer): string {
  let binary = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

const PluginInstallModal: React.FC<Props> = ({ onClose, initialFile }) => {
  const { t } = useTranslation()
  const fileInput = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [fileB64, setFileB64] = useState('')
  const [preview, setPreview] = useState<IPluginDescriptorPreview | null>(null)
  const [busy, setBusy] = useState(false)

  // file -> base64, or null if rejected/unreadable (toasts here)
  const loadFile = async (f: File): Promise<string | null> => {
    if (f.size > MAX_CPX_BYTES) {
      toast.error(t('plugins.fileTooLarge'))
      return null
    }
    try {
      const b64 = abToBase64(await f.arrayBuffer())
      setFileName(f.name)
      setFileB64(b64)
      setPreview(null)
      return b64
    } catch {
      toast.error(t('plugins.previewFailed'))
      return null
    }
  }

  // preview by explicit b64 (state may not be flushed yet)
  const previewB64 = async (b64: string): Promise<void> => {
    setBusy(true)
    try {
      setPreview(await previewPlugin(b64))
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      toast.error(msg.includes('v1') ? t('plugins.outdatedFile') : t('plugins.previewFailed'))
    } finally {
      setBusy(false)
    }
  }

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const f = e.target.files?.[0]
    if (!f) return
    await loadFile(f)
  }

  const doPreview = async (): Promise<void> => {
    await previewB64(fileB64)
  }

  useEffect(() => {
    if (!initialFile) return
    loadFile(initialFile).then((b64) => {
      if (b64) previewB64(b64)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const doInstall = async (): Promise<void> => {
    setBusy(true)
    try {
      await installPlugin(fileB64)
      toast.success(t('plugins.installed'))
      onClose()
    } catch {
      toast.error(t('plugins.installFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal isOpen onOpenChange={(open) => !open && onClose()} size="md">
      <ModalContent>
        <ModalHeader>{preview ? t('plugins.confirmTitle') : t('plugins.import')}</ModalHeader>
        <ModalBody>
          {!preview ? (
            <div className="flex flex-col gap-3">
              <input
                ref={fileInput}
                type="file"
                accept=".cpx"
                className="hidden"
                onChange={onPickFile}
              />
              <Button variant="flat" isDisabled={busy} onPress={() => fileInput.current?.click()}>
                {fileName || t('plugins.chooseFile')}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2 text-sm">
              <div>
                {t('plugins.provider')}: <b>{preview.name}</b>
              </div>
              {preview.site && (
                <div>
                  {t('plugins.site')}: {preview.site}
                </div>
              )}
              <div>
                {t('plugins.loginUrl')}: <b>{hostOf(preview.loginUrl)}</b>
              </div>
              <div className="mt-2 text-warning">{t('plugins.installNotice')}</div>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={onClose}>
            {t('plugins.cancel')}
          </Button>
          {!preview ? (
            <Button color="primary" isLoading={busy} isDisabled={!fileB64} onPress={doPreview}>
              {t('plugins.next')}
            </Button>
          ) : (
            <Button color="primary" isLoading={busy} onPress={doInstall}>
              {t('plugins.install')}
            </Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default PluginInstallModal
