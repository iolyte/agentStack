import { appLocalDataDir } from '@tauri-apps/api/path'
import { invoke } from '@tauri-apps/api/core'
import { Client, Stronghold } from '@tauri-apps/plugin-stronghold'
import './styles.css'

type RemoteAccessStatus = {
  cloudflareAvailable: boolean
  cloudflareSource: string
  cloudflareVersion: string | null
  sidecarConfigured: boolean
  sidecarProvisioned: boolean
  tunnelConfigured: boolean
  tunnelRunning: boolean
  tunnelName: string | null
  tunnelId: string | null
  hostname: string | null
  accessEmail: string | null
  accessConfirmed: boolean
  remoteUrl: string | null
  accessGuideUrl: string
  configPath: string | null
  lastStartedAt: string | null
  lastStoppedAt: string | null
  lastOutput: string
}

type LauncherStatus = {
  mode: 'repo' | 'runtime'
  dockerInstalled: boolean
  dockerRunning: boolean
  repoRoot: string | null
  runtimeRoot: string
  envPath: string
  envExists: boolean
  envReady: boolean
  uiReachable: boolean
  runningServices: string[]
  output: string
  remoteAccess: RemoteAccessStatus
}

type CloudflareLoginResult = {
  status: LauncherStatus
  certPem: string
}

type CloudflareTunnelResult = {
  status: LauncherStatus
  credentialsJson: string
}

type VaultSummary = {
  unlocked: boolean
  hasCert: boolean | null
  hasCredentials: boolean | null
  message: string
}

type VaultSession = {
  stronghold: Stronghold
  client: Client
  password: string
}

const VAULT_CLIENT = 'clawstack-remote-access'
const CERT_KEY = 'cloudflare-cert-pem'
const CREDENTIALS_KEY = 'cloudflare-credentials-json'

const statusGrid = document.querySelector<HTMLElement>('#status-grid')
const remoteGrid = document.querySelector<HTMLElement>('#remote-grid')
const outputNode = document.querySelector<HTMLElement>('#output')
const modePill = document.querySelector<HTMLElement>('#mode-pill')
const refreshButton = document.querySelector<HTMLButtonElement>('#refresh')
const actionButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-action]'))

const vaultPassphraseInput = document.querySelector<HTMLInputElement>('#vault-passphrase')
const tunnelNameInput = document.querySelector<HTMLInputElement>('#tunnel-name')
const hostnameInput = document.querySelector<HTMLInputElement>('#hostname')
const accessEmailInput = document.querySelector<HTMLInputElement>('#access-email')

const unlockVaultButton = document.querySelector<HTMLButtonElement>('#unlock-vault')
const connectCloudflareButton = document.querySelector<HTMLButtonElement>('#connect-cloudflare')
const createTunnelButton = document.querySelector<HTMLButtonElement>('#create-tunnel')
const startRemoteButton = document.querySelector<HTMLButtonElement>('#start-remote')
const stopRemoteButton = document.querySelector<HTMLButtonElement>('#stop-remote')
const openAccessGuideButton = document.querySelector<HTMLButtonElement>('#open-access-guide')
const confirmAccessButton = document.querySelector<HTMLButtonElement>('#confirm-access')
const clearRemoteButton = document.querySelector<HTMLButtonElement>('#clear-remote')

let currentStatus: LauncherStatus | null = null
let vaultSummary: VaultSummary = {
  unlocked: false,
  hasCert: null,
  hasCredentials: null,
  message: 'Vault locked',
}
let vaultSession: VaultSession | null = null

function setOutput(message: string) {
  if (outputNode) {
    outputNode.textContent = message || 'No launcher output yet.'
  }
}

function statusTone(value: string) {
  if (
    value === 'Yes' ||
    value === 'Configured' ||
    value === 'Unlocked' ||
    value === 'Saved' ||
    value === 'Connected' ||
    value === 'Running' ||
    value.startsWith('Reachable') ||
    value.startsWith('Ready')
  ) {
    return 'status-good'
  }

  if (
    value === 'No' ||
    value === 'Locked' ||
    value === 'Missing' ||
    value === 'Pending' ||
    value === 'Not started' ||
    value.startsWith('Needs') ||
    value.startsWith('Placeholder') ||
    value.startsWith('Unlock')
  ) {
    return 'status-warn'
  }

  return ''
}

function renderGrid(node: HTMLElement | null, rows: Array<[string, string]>) {
  if (!node) {
    return
  }

  node.innerHTML = rows
    .map(([label, value]) => {
      const tone = statusTone(value)
      return `<div><dt>${label}</dt><dd class="${tone}">${value}</dd></div>`
    })
    .join('')
}

function renderStatus(status: LauncherStatus) {
  currentStatus = status

  if (modePill) {
    modePill.textContent = status.mode === 'repo' ? 'Repo mode' : 'Runtime mode'
  }

  renderGrid(statusGrid, [
    ['Docker installed', status.dockerInstalled ? 'Yes' : 'No'],
    ['Docker running', status.dockerRunning ? 'Yes' : 'No'],
    ['Environment file', status.envExists ? status.envPath : `Missing: ${status.envPath}`],
    ['Environment ready', status.envReady ? 'Configured' : 'Needs API keys or passwords'],
    ['Mission Control', status.uiReachable ? 'Reachable at http://localhost' : 'Not reachable yet'],
    ['Running services', status.runningServices.length ? status.runningServices.join(', ') : 'No running services detected'],
    ['Repo root', status.repoRoot || 'Not available in this mode'],
    ['Runtime root', status.runtimeRoot],
  ])

  renderGrid(remoteGrid, [
    [
      'Cloudflare binary',
      status.remoteAccess.cloudflareAvailable
        ? `Ready (${status.remoteAccess.cloudflareSource})`
        : status.remoteAccess.sidecarConfigured
          ? 'Placeholder sidecar'
          : 'Missing',
    ],
    ['Cloudflare version', status.remoteAccess.cloudflareVersion || 'Not detected'],
    ['Vault', vaultSummary.unlocked ? 'Unlocked' : 'Locked'],
    ['Stored cert', vaultSummary.hasCert === null ? 'Unlock to inspect' : vaultSummary.hasCert ? 'Saved' : 'Missing'],
    [
      'Stored tunnel creds',
      vaultSummary.hasCredentials === null ? 'Unlock to inspect' : vaultSummary.hasCredentials ? 'Saved' : 'Missing',
    ],
    ['Tunnel config', status.remoteAccess.tunnelConfigured ? 'Configured' : 'Pending'],
    ['Tunnel process', status.remoteAccess.tunnelRunning ? 'Running' : 'Not started'],
    ['Public hostname', status.remoteAccess.hostname || 'Pending'],
    ['Access email', status.remoteAccess.accessEmail || 'Pending'],
    ['Access policy', status.remoteAccess.accessConfirmed ? 'Configured' : 'Pending'],
    ['Remote URL', status.remoteAccess.remoteUrl || 'Pending'],
    ['Config path', status.remoteAccess.configPath || 'Pending'],
  ])

  setOutput(status.output || status.remoteAccess.lastOutput || 'No launcher output yet.')
}

function bytesFromString(value: string) {
  return Array.from(new TextEncoder().encode(value))
}

function stringFromBytes(value: number[] | Uint8Array | null | undefined) {
  if (!value) {
    return null
  }

  return new TextDecoder().decode(new Uint8Array(value))
}

async function getVaultPath() {
  return `${await appLocalDataDir()}clawstack-remote-access.hold`
}

async function unlockVault(force = false) {
  const password = vaultPassphraseInput?.value.trim() || ''
  if (!password) {
    throw new Error('Enter a vault passphrase before unlocking the stronghold vault.')
  }

  if (!force && vaultSession && vaultSession.password === password) {
    return vaultSession
  }

  const stronghold = await Stronghold.load(await getVaultPath(), password)
  let client: Client

  try {
    client = await stronghold.loadClient(VAULT_CLIENT)
  } catch {
    client = await stronghold.createClient(VAULT_CLIENT)
    await stronghold.save()
  }

  vaultSession = { stronghold, client, password }
  await refreshVaultSummary()
  return vaultSession
}

async function readSecret(key: string) {
  const session = await unlockVault()
  const store = session.client.getStore()
  return stringFromBytes(await store.get(key))
}

async function writeSecret(key: string, value: string) {
  const session = await unlockVault()
  const store = session.client.getStore()
  await store.insert(key, bytesFromString(value))
  await session.stronghold.save()
}

async function removeSecret(key: string) {
  const session = await unlockVault()
  const store = session.client.getStore()
  await store.remove(key)
  await session.stronghold.save()
}

async function refreshVaultSummary() {
  if (!vaultSession) {
    vaultSummary = {
      unlocked: false,
      hasCert: null,
      hasCredentials: null,
      message: 'Vault locked',
    }
    if (currentStatus) {
      renderStatus(currentStatus)
    }
    return
  }

  const store = vaultSession.client.getStore()
  const cert = await store.get(CERT_KEY)
  const credentials = await store.get(CREDENTIALS_KEY)

  vaultSummary = {
    unlocked: true,
    hasCert: Boolean(cert && cert.length),
    hasCredentials: Boolean(credentials && credentials.length),
    message: 'Vault unlocked',
  }

  if (currentStatus) {
    renderStatus(currentStatus)
  }
}

async function refreshStatus() {
  const status = await invoke<LauncherStatus>('launcher_status')
  renderStatus(status)
}

async function runAction(action: string, button?: HTMLButtonElement | null) {
  const target = button ?? null
  if (target) {
    target.disabled = true
  }

  try {
    const commandMap: Record<string, string> = {
      start: 'start_stack',
      stop: 'stop_stack',
      restart: 'restart_stack',
      openUi: 'open_ui',
      openRuntimeDir: 'open_runtime_dir',
    }

    const command = commandMap[action]
    if (!command) {
      throw new Error(`Unsupported action: ${action}`)
    }

    renderStatus(await invoke<LauncherStatus>(command))
  } catch (error) {
    setOutput(error instanceof Error ? error.message : String(error))
  } finally {
    if (target) {
      target.disabled = false
    }
  }
}

async function withButton(button: HTMLButtonElement | null | undefined, work: () => Promise<void>) {
  if (button) {
    button.disabled = true
  }

  try {
    await work()
  } catch (error) {
    setOutput(error instanceof Error ? error.message : String(error))
  } finally {
    if (button) {
      button.disabled = false
    }
  }
}

refreshButton?.addEventListener('click', () => {
  void refreshStatus()
})

actionButtons.forEach((button) => {
  button.addEventListener('click', () => {
    void runAction(button.dataset.action || '', button)
  })
})

unlockVaultButton?.addEventListener('click', () => {
  void withButton(unlockVaultButton, async () => {
    await unlockVault(true)
    await refreshVaultSummary()
    setOutput('Stronghold vault unlocked for this desktop session.')
  })
})

connectCloudflareButton?.addEventListener('click', () => {
  void withButton(connectCloudflareButton, async () => {
    await unlockVault()
    const result = await invoke<CloudflareLoginResult>('cloudflare_login')
    await writeSecret(CERT_KEY, result.certPem)
    await refreshVaultSummary()
    renderStatus(result.status)
    setOutput(`${result.status.output}\n\nStored the Cloudflare account certificate in the stronghold vault.`)
  })
})

createTunnelButton?.addEventListener('click', () => {
  void withButton(createTunnelButton, async () => {
    const certPem = await readSecret(CERT_KEY)
    if (!certPem) {
      throw new Error('Connect Cloudflare first so ClawStack can save the account certificate in the vault.')
    }

    const result = await invoke<CloudflareTunnelResult>('create_remote_tunnel', {
      tunnelName: tunnelNameInput?.value || '',
      hostname: hostnameInput?.value || '',
      accessEmail: accessEmailInput?.value.trim() || null,
      certPem,
    })

    await writeSecret(CREDENTIALS_KEY, result.credentialsJson)
    await refreshVaultSummary()
    renderStatus(result.status)
    setOutput(`${result.status.output}\n\nStored the tunnel credentials in the stronghold vault.`)
  })
})

startRemoteButton?.addEventListener('click', () => {
  void withButton(startRemoteButton, async () => {
    const credentialsJson = await readSecret(CREDENTIALS_KEY)
    if (!credentialsJson) {
      throw new Error('Create the Cloudflare tunnel first so the launcher can save tunnel credentials in the vault.')
    }

    renderStatus(await invoke<LauncherStatus>('start_remote_access', { credentialsJson }))
  })
})

stopRemoteButton?.addEventListener('click', () => {
  void withButton(stopRemoteButton, async () => {
    renderStatus(await invoke<LauncherStatus>('stop_remote_access'))
  })
})

openAccessGuideButton?.addEventListener('click', () => {
  void withButton(openAccessGuideButton, async () => {
    renderStatus(await invoke<LauncherStatus>('open_access_guide'))
  })
})

confirmAccessButton?.addEventListener('click', () => {
  void withButton(confirmAccessButton, async () => {
    renderStatus(
      await invoke<LauncherStatus>('confirm_remote_access', {
        accessEmail: accessEmailInput?.value.trim() || null,
      }),
    )
  })
})

clearRemoteButton?.addEventListener('click', () => {
  void withButton(clearRemoteButton, async () => {
    const status = await invoke<LauncherStatus>('clear_remote_access')

    if (vaultPassphraseInput?.value.trim()) {
      try {
        await unlockVault(true)
        await removeSecret(CERT_KEY)
        await removeSecret(CREDENTIALS_KEY)
        await refreshVaultSummary()
        setOutput(`${status.output}\n\nRemoved the saved Cloudflare secrets from the stronghold vault.`)
      } catch {
        setOutput(`${status.output}\n\nRemote access metadata was cleared, but the vault remained locked so stored secrets were left untouched.`)
      }
    } else {
      vaultSession = null
      await refreshVaultSummary()
      setOutput(`${status.output}\n\nEnter the vault passphrase and run Clear again if you also want to remove saved tunnel secrets.`)
    }

    renderStatus(status)
  })
})

window.setInterval(() => {
  void refreshStatus()
}, 10_000)

void refreshStatus()
