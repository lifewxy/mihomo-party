import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { pluginConfigPath } from '../utils/dirs'
import { parse, stringify } from '../utils/yaml'

let pluginConfig: IPluginConfig | undefined
let writeQueue: Promise<void> = Promise.resolve()

export async function getPluginConfig(force = false): Promise<IPluginConfig> {
  if (force || !pluginConfig) {
    if (existsSync(pluginConfigPath())) {
      const data = await readFile(pluginConfigPath(), 'utf-8')
      pluginConfig = parse<IPluginConfig>(data)
    } else {
      pluginConfig = { items: [] }
    }
    if (typeof pluginConfig !== 'object' || pluginConfig === null) pluginConfig = { items: [] }
    if (!Array.isArray(pluginConfig.items)) pluginConfig.items = []
  }
  return JSON.parse(JSON.stringify(pluginConfig)) as IPluginConfig
}

async function update(updater: (c: IPluginConfig) => IPluginConfig): Promise<void> {
  const run = writeQueue.then(async () => {
    const current = await getPluginConfig(true)
    const next = updater(current)
    pluginConfig = next
    await writeFile(pluginConfigPath(), stringify(next), 'utf-8')
  })
  // Keep the queue chain settled so a rejected op doesn't poison later writes,
  // but still surface this op's error/result to the caller via `run`.
  writeQueue = run.catch(() => {})
  await run
}

export async function getPluginItem(id: string): Promise<IPluginItem | undefined> {
  const { items } = await getPluginConfig()
  return items.find((i) => i.id === id)
}

export async function addPluginItem(newItem: IPluginItem): Promise<void> {
  await update((c) => {
    const idx = c.items.findIndex((i) => i.id === newItem.id)
    if (idx === -1) c.items.push(newItem)
    else c.items[idx] = newItem
    return c
  })
}

export async function updatePluginItem(newItem: IPluginItem): Promise<void> {
  await update((c) => {
    const idx = c.items.findIndex((i) => i.id === newItem.id)
    if (idx === -1) throw new Error('Plugin not found')
    c.items[idx] = newItem
    return c
  })
}

export async function removePluginItem(id: string): Promise<void> {
  await update((c) => {
    c.items = c.items.filter((i) => i.id !== id)
    return c
  })
}
