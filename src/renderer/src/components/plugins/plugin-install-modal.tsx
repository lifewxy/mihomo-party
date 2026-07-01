import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button } from '@heroui/react'
import React, { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@renderer/components/base/toast'
import { previewPlugin, installPlugin } from '@renderer/utils/ipc'

interface Props {
  onClose: () => void
}

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

const PluginInstallModal: React.FC<Props> = ({ onClose }) => {
  const { t } = useTranslation()
  const fileInput = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [fileB64, setFileB64] = useState('')
  const [preview, setPreview] = useState<IPluginDescriptorPreview | null>(null)
  const [busy, setBusy] = useState(false)

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const f = e.target.files?.[0]
    if (!f) return
    setFileName(f.name)
    setFileB64(abToBase64(await f.arrayBuffer()))
    setPreview(null)
  }

  const doPreview = async (): Promise<void> => {
    setBusy(true)
    try {
      setPreview(await previewPlugin(fileB64))
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      toast.error(msg.includes('v1') ? t('plugins.outdatedFile') : t('plugins.previewFailed'))
    } finally {
      setBusy(false)
    }
  }

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
              <Button variant="flat" onPress={() => fileInput.current?.click()}>
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
