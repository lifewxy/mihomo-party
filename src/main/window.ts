import { join } from 'path'
import { readFileSync, writeFileSync } from 'fs'
import { BrowserWindow, Menu, screen, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { getAppConfig } from './config'
import { quitWithoutCore, stopCore } from './core/manager'
import { triggerSysProxy } from './sys/sysproxy'
import { hideDockIcon, showDockIcon } from './resolve/tray'
import { dataDir } from './utils/dirs'
import { mainWindowLogger } from './utils/logger'

interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  isMaximized?: boolean
}

function loadWindowState(): WindowState {
  try {
    const raw = readFileSync(join(dataDir(), 'window-state.json'), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return { width: 800, height: 600 }
  }
}

function saveWindowState(window: BrowserWindow): void {
  const isMaximized = window.isMaximized()
  const state: WindowState = isMaximized
    ? { ...loadWindowState(), isMaximized: true }
    : { ...window.getContentBounds(), isMaximized: false }
  writeFileSync(join(dataDir(), 'window-state.json'), JSON.stringify(state))
}

function ensureVisibleOnScreen(state: WindowState): WindowState {
  const displays = screen.getAllDisplays()
  const visible = displays.some((d) => {
    const b = d.bounds
    return (
      state.x !== undefined &&
      state.y !== undefined &&
      state.x >= b.x &&
      state.y >= b.y &&
      state.x < b.x + b.width &&
      state.y < b.y + b.height
    )
  })
  return visible ? state : { width: state.width, height: state.height }
}

export let mainWindow: BrowserWindow | null = null
let quitTimeout: NodeJS.Timeout | null = null
let createWindowPromise: Promise<void> | null = null

// 主窗口 renderer 崩溃自动恢复的防抖，避免崩溃循环时无限重建
const MAIN_WINDOW_CRASH_WINDOW = 60 * 1000
const MAIN_WINDOW_MAX_CRASH_RECOVERIES = 3
let mainWindowCrashTimestamps: number[] = []
type AutoQuitWithoutCoreMode = NonNullable<IAppConfig['autoQuitWithoutCoreMode']>

export async function createWindow(): Promise<void> {
  if (mainWindow && !mainWindow.isDestroyed()) return
  if (createWindowPromise) return createWindowPromise

  createWindowPromise = createWindowInternal().finally(() => {
    createWindowPromise = null
  })
  return createWindowPromise
}

async function createWindowInternal(): Promise<void> {
  const {
    useWindowFrame = false,
    silentStart = false,
    autoQuitWithoutCore = false,
    autoQuitWithoutCoreDelay = 60,
    autoQuitWithoutCoreMode = 'core'
  } = await getAppConfig()

  const savedState = ensureVisibleOnScreen(loadWindowState())

  Menu.setApplicationMenu(null)
  mainWindow = new BrowserWindow({
    minWidth: 800,
    minHeight: 600,
    width: savedState.width,
    height: savedState.height,
    x: savedState.x,
    y: savedState.y,
    show: false,
    frame: useWindowFrame,
    fullscreenable: false,
    titleBarStyle: useWindowFrame ? 'default' : 'hidden',
    titleBarOverlay: useWindowFrame
      ? false
      : {
          height: 49
        },
    autoHideMenuBar: true,
    // Win 显式指定 icon，避免异常/恢复路径下任务栏与窗口图标依赖默认 exe
    ...(process.platform === 'linux' || process.platform === 'win32' ? { icon: icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      spellcheck: false,
      sandbox: false,
      devTools: true
    }
  })

  if (savedState.isMaximized && !silentStart) {
    mainWindow.maximize()
  }

  setupWindowEvents(mainWindow, {
    silentStart,
    autoQuitWithoutCore,
    autoQuitWithoutCoreDelay,
    autoQuitWithoutCoreMode
  })

  if (is.dev) {
    mainWindow.webContents.openDevTools()
  }

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

interface WindowConfig {
  silentStart: boolean
  autoQuitWithoutCore: boolean
  autoQuitWithoutCoreDelay: number
  autoQuitWithoutCoreMode: AutoQuitWithoutCoreMode
}

function setupWindowEvents(window: BrowserWindow, config: WindowConfig): void {
  const { silentStart, autoQuitWithoutCore, autoQuitWithoutCoreDelay, autoQuitWithoutCoreMode } =
    config

  window.on('ready-to-show', () => {
    if (autoQuitWithoutCore && !window.isVisible()) {
      scheduleQuitWithoutCore(autoQuitWithoutCoreDelay, autoQuitWithoutCoreMode)
    }

    // 开发模式下始终显示窗口
    if (!silentStart || is.dev) {
      clearQuitTimeout()
      window.show()
      window.focusOnWebView()
    }
  })

  window.webContents.on('did-fail-load', () => {
    window.webContents.reload()
  })

  // renderer 崩溃时外壳仍在（isDestroyed() 为 false）、did-fail-load 不触发，会白屏；销毁并按需重建
  window.webContents.on('render-process-gone', (_event, details) => {
    mainWindowLogger.error('Main window render process gone', details.reason).catch(() => {})

    if (mainWindow !== window || window.isDestroyed()) return

    const wasVisible = window.isVisible()

    mainWindow = null
    window.destroy()

    const now = Date.now()
    mainWindowCrashTimestamps = mainWindowCrashTimestamps.filter(
      (timestamp) => now - timestamp < MAIN_WINDOW_CRASH_WINDOW
    )
    mainWindowCrashTimestamps.push(now)

    if (mainWindowCrashTimestamps.length > MAIN_WINDOW_MAX_CRASH_RECOVERIES) {
      mainWindowLogger
        .error(
          `Main window renderer crashed ${mainWindowCrashTimestamps.length} times within ${MAIN_WINDOW_CRASH_WINDOW}ms, stop auto-recovery`
        )
        .catch(() => {})
      return
    }

    // 可见时立即重建，否则留待下次 showMainWindow()，避免后台崩溃突然弹窗
    if (wasVisible) {
      void createWindow().then(() => {
        clearQuitTimeout()
        mainWindow?.show()
        mainWindow?.focusOnWebView()
      })
    }
  })

  window.webContents.on('unresponsive', () => {
    mainWindowLogger.error('Main window unresponsive').catch(() => {})
  })

  window.on('show', () => {
    showDockIcon()
  })

  window.on('close', async (event) => {
    event.preventDefault()
    window.hide()

    const {
      autoQuitWithoutCore = false,
      autoQuitWithoutCoreDelay = 60,
      autoQuitWithoutCoreMode = 'core',
      useDockIcon = true
    } = await getAppConfig()

    if (!useDockIcon) {
      hideDockIcon()
    }

    if (autoQuitWithoutCore) {
      scheduleQuitWithoutCore(autoQuitWithoutCoreDelay, autoQuitWithoutCoreMode)
    }
  })

  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null
    }
  })

  window.on('resized', () => saveWindowState(window))
  window.on('moved', () => saveWindowState(window))
  window.on('maximize', () => saveWindowState(window))
  window.on('unmaximize', () => saveWindowState(window))

  window.on('session-end', async () => {
    await triggerSysProxy(false)
    await stopCore()
  })

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
}

function scheduleQuitWithoutCore(
  delaySeconds: number,
  mode: AutoQuitWithoutCoreMode = 'core'
): void {
  clearQuitTimeout()
  quitTimeout = setTimeout(async () => {
    if (mode === 'tray') {
      if (mainWindow && !mainWindow.isVisible()) {
        mainWindow.destroy()
        hideDockIcon()
      }
      return
    }

    await quitWithoutCore()
  }, delaySeconds * 1000)
}

export function clearQuitTimeout(): void {
  if (quitTimeout) {
    clearTimeout(quitTimeout)
    quitTimeout = null
  }
}

export function triggerMainWindow(force?: boolean): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    showMainWindow()
    return
  }

  getAppConfig()
    .then(({ triggerMainWindowBehavior = 'toggle' }) => {
      if (force === true || triggerMainWindowBehavior === 'toggle') {
        if (mainWindow?.isVisible()) {
          closeMainWindow()
        } else {
          showMainWindow()
        }
      } else {
        showMainWindow()
      }
    })
    .catch(showMainWindow)
}

export function showMainWindow(): void {
  clearQuitTimeout()

  if (mainWindow && !mainWindow.isDestroyed()) {
    clearQuitTimeout()
    // 兜底：renderer 已崩溃但 render-process-gone 尚未触发时，先 reload 再显示，避免白屏
    if (mainWindow.webContents.isCrashed()) {
      mainWindow.webContents.reload()
    }
    mainWindow.show()
    mainWindow.focusOnWebView()
    return
  }

  void createWindow().then(() => {
    clearQuitTimeout()
    mainWindow?.show()
    mainWindow?.focusOnWebView()
  })
}

export function closeMainWindow(): void {
  mainWindow?.close()
}
