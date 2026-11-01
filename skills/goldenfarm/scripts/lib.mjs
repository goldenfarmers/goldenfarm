import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const RELAY = (process.env.GOLDENFARM_RELAY || 'https://goldenfarm.fun').replace(/\/$/, '')
const BSC = '56'
const ZERO = '0x0000000000000000000000000000000000000000'
const STATE_DIR = process.env.GOLDENFARM_STATE_DIR || join(tmpdir(), 'goldenfarm')
const PENDING_WAIT_MS = Number(process.env.GOLDENFARM_PENDING_WAIT_MS || 120000)
const POLL_MS = Number(process.env.GOLDENFARM_POLL_MS || 3000)

export const HINTS = {
  no_baw: {
    zh: '还没装币安 Agentic Wallet 的命令行。先装币安官方 Skill：npx skills add binance/binance-skills-hub/skills/binance-web3/binance-agentic-wallet',
    en: 'The Binance Agentic Wallet CLI is not installed. Install the official Binance skill first: npx skills add binance/binance-skills-hub/skills/binance-web3/binance-agentic-wallet',
  },
  not_signed_in: {
    zh: '还没登录币安 Agentic Wallet。用币安官方 Skill 登录：会给一个链接和配对码，在币安 App 里确认。',
    en: 'Not signed in to the Binance Agentic Wallet. Sign in with the official Binance skill: it gives a link and a pairing code to confirm in the Binance App.',
  },
  wallet_creating: {
    zh: 'Agentic Wallet 还在创建，等一会儿再试。',
    en: 'The Agentic Wallet is still being set up. Try again in a moment.',
  },
  no_agent_id: {
    zh: '这个 Agentic Wallet 还没有 Agent ID。去币安 App 免费领一个 .ai 名字再来；也可以在网页上用钱包预约（领普通款稻草人）。',
    en: 'This Agentic Wallet has no Agent ID yet. Claim a free .ai name in the Binance App, then come back; or reserve on the website with a wallet (standard scarecrow).',
  },
  dev_mode_off: {
    zh: '要先打开开发者模式：币安 App → Agentic Wallet 管理页 → 设置 → 开发者模式 → 确认风险提示 → 批准签名。打开后 7 天有效。',
    en: 'Turn on Developer Mode first: Binance App → Agentic Wallet management page → Settings → Developer Mode → confirm the risk warning → approve. It lasts 7 days.',
  },
  dev_balance_exceeded: {
    zh: 'Agentic Wallet 里的余额超过了开发者模式的上限，签不了名。先转出一部分再试。',
    en: 'The Agentic Wallet balance is above the Developer Mode limit, so it cannot sign. Move some funds out and try again.',
  },
  bad_inviter: {
    zh: '没找到这个邀请人。邀请人要先预约过；可以写对方的 .ai 名字或预约序号。',
    en: 'Inviter not found. The inviter must have reserved first; use their .ai name or reservation number.',
  },
  pending_timeout: {
    zh: '还在等币安 App 里的确认。确认后让 AI 再跑一次同样的确认命令。',
    en: 'Still waiting for approval in the Binance App. After approving, run the same confirm command again.',
  },
  rejected: { zh: '签名被拒绝了，没有预约。', en: 'The signature was rejected. Nothing was reserved.' },
  expired: { zh: '签名请求过期了，重新预览一次。', en: 'The signature request expired. Run the preview again.' },
  unknown_request: { zh: '找不到这次预览，重新预览一次。', en: 'This preview was not found. Run the preview again.' },
  relay_unreachable: { zh: '连不上淘金农场的预约服务，稍后再试。', en: 'Cannot reach the GoldenFarm reservation service. Try again later.' },
  bad_quantity: { zh: '一次买 1 到 10 张。', en: 'Buy 1 to 10 cards at a time.' },
  wallet_limit: {
    zh: '每个钱包最多买 10 张，这个钱包剩下的名额不够这么多张。',
    en: 'Each wallet can buy at most 10 cards, and this wallet does not have that many left.',
  },
  sold_out: { zh: '创世卡已经卖完了。', en: 'Genesis Cards are sold out.' },
  low_balance: {
    zh: 'Agentic Wallet 里的 BNB 不够付卡钱和手续费。先往这个钱包转一些 BSC 上的 BNB。',
    en: 'The Agentic Wallet does not have enough BNB for the cards and gas. Send some BNB on BSC to this wallet first.',
  },
  risk_blocked: {
    zh: '币安的风险检查拦下了这笔交易，没有扣钱。',
    en: "Binance's risk check blocked this transaction. Nothing was charged.",
  },
  card_pending: {
    zh: '交易在等币安 App 里的批准，或者还没上链。批准后让 AI 再跑一次同样的购买命令，或者查一下 card-status。',
    en: 'The transaction is waiting for approval in the Binance App or is not on chain yet. After approving, run the same buy command again or check card-status.',
  },
  buy_failed: { zh: '交易没有成功，没有买到卡。', en: 'The transaction failed. No card was bought.' },
  rpc_unreachable: { zh: '连不上 BSC 节点，稍后再试。', en: 'Cannot reach the BSC node. Try again later.' },
}

export class GfError extends Error {
  constructor(code, message, extra = {}) {
    super(message)
    this.code = code
    this.extra = extra
  }
}

let bawCache
function bawCommand() {
  if (bawCache) return bawCache
  const custom = process.env.GOLDENFARM_BAW
  if (custom) return (bawCache = /\.(c|m)?js$/.test(custom) ? [process.execPath, [custom]] : [custom, []])
  const candidates = []
  if (process.env.APPDATA) candidates.push(join(process.env.APPDATA, 'npm', 'node_modules', '@binance', 'agentic-wallet', 'dist', 'index.js'))
  try {
    const win = process.platform === 'win32'
    const root = execFileSync(win ? 'npm.cmd' : 'npm', ['root', '-g'], { encoding: 'utf8', shell: win, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (root) candidates.push(join(root, '@binance', 'agentic-wallet', 'dist', 'index.js'))
  } catch {}
  const js = candidates.find((p) => existsSync(p))
  return (bawCache = js ? [process.execPath, [js]] : ['baw', []])
}

function parseJson(text) {
  const t = text.trim()
  try {
    return JSON.parse(t)
  } catch {}
  const last = t.split('\n').filter((l) => l.trim().startsWith('{')).pop()
  try {
    return last ? JSON.parse(last) : undefined
  } catch {
    return undefined
  }
}

export function runBaw(args, { timeoutMs = 90000 } = {}) {
  const [cmd, pre] = bawCommand()
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(cmd, [...pre, ...args, '--json'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    } catch (e) {
      return reject(new GfError('no_baw', String(e)))
    }
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e.code === 'ENOENT' ? new GfError('no_baw', 'baw not found') : new GfError('baw_error', String(e)))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const json = parseJson(out)
      if (json && json.success && 'data' in json) return resolve(json.data)
      const message = json?.message || json?.error?.message || json?.msg || err.trim() || out.trim() || `baw exited with ${code}`
      reject(new GfError('baw_error', message, { bawCode: json?.code ?? json?.error?.code ?? null, command: `baw ${args.slice(0, 2).join(' ')}` }))
    })
  })
}

export async function relay(path, body) {
  let res
  try {
    res = await fetch(RELAY + path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  } catch {
    throw new GfError('relay_unreachable', `cannot reach ${RELAY}`)
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new GfError(data.code || 'relay_error', data.error || `HTTP ${res.status}`)
  return data
}

export async function report(step) {
  if (process.env.GOLDENFARM_NO_STATS === '1') return
  await relay('/api/funnel', { step }).catch(() => {})
}

const fail = async (code, step = code) => {
  await report(step)
  throw new GfError(code, HINTS[code]?.en ?? code)
}

export async function checkWallet() {
  let status
  try {
    status = await runBaw(['wallet', 'status'])
  } catch (e) {
    if (e.code === 'no_baw') await fail('no_baw')
    throw e
  }
  if (status.status === 'UNCONNECTED') await fail('not_signed_in')
  if (status.status === 'CREATING') await fail('wallet_creating')
  const { addresses = [] } = await runBaw(['wallet', 'address'])
  const bsc = addresses.find((a) => String(a.binanceChainId) === BSC)
  if (!bsc) throw new GfError('baw_error', 'no BSC address in `baw wallet address`')
  const id = await runBaw(['wallet', 'agent-id'])
  const settings = await runBaw(['wallet', 'settings'])
  const dev = settings.devMode || {}
  const expires = expiryMs(dev.expiresAt)
  const devOn = !!dev.enabled && (expires === null || expires > Date.now())
  return {
    address: bsc.address,
    agentId: id.claimed ? id.agentId : null,
    devMode: { enabled: devOn, expiresAt: dev.expiresAt ?? null, balanceExceeded: !!dev.balanceExceeded },
  }
}

function expiryMs(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (Number.isFinite(n)) return n > 1e12 ? n : n * 1000
  const t = Date.parse(value)
  return Number.isNaN(t) ? null : t
}

export async function resolveInviter(code) {
  const c = String(code).trim().replace(/^#/, '')
  if (!c) return undefined
  if (/^0x[0-9a-fA-F]{40}$/.test(c) || /^\d+$/.test(c)) return c
  const name = c.includes('.') ? c : `${c}.ai`
  try {
    const r = await runBaw(['wallet', 'resolve-domain', '--name', name, '--binanceChainId', BSC])
    if (r.address) return r.address
  } catch {}
  throw new GfError('bad_inviter', HINTS.bad_inviter.en)
}

export function signRequest(wallet, typed) {
  const full = {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
      ],
      ...typed.types,
    },
    domain: typed.domain,
    primaryType: typed.primaryType,
    message: typed.message,
  }
  return JSON.stringify({ method: 'eth_signTypedData_v4', params: [wallet, JSON.stringify(full)] })
}

const statePath = (id) => join(STATE_DIR, `${String(id).replace(/[^\w.-]/g, '_')}.json`)

export function saveState(id, value) {
  mkdirSync(STATE_DIR, { recursive: true })
  writeFileSync(statePath(id), JSON.stringify(value))
}

export function loadState(id) {
  const p = statePath(id)
  if (!existsSync(p)) throw new GfError('unknown_request', HINTS.unknown_request.en)
  return JSON.parse(readFileSync(p, 'utf8'))
}

export function removeState(id) {
  rmSync(statePath(id), { force: true })
}

export async function reservationStatus({ wallet, number, name } = {}) {
  let q
  if (wallet) q = `address=${encodeURIComponent(wallet)}`
  else if (number !== undefined) q = `number=${encodeURIComponent(number)}`
  else if (name) q = `name=${encodeURIComponent(name)}`
  else {
    const { addresses = [] } = await runBaw(['wallet', 'address'])
    const bsc = addresses.find((a) => String(a.binanceChainId) === BSC)
    if (!bsc) throw new GfError('baw_error', 'no BSC address in `baw wallet address`')
    q = `address=${bsc.address}`
  }
  return relay(`/api/reservation/status?${q}`)
}

export async function stats() {
  const [count, recent, board] = await Promise.all([
    relay('/api/reservation/count'),
    relay('/api/reservation/recent?limit=5'),
    relay('/api/invite/leaderboard?limit=5'),
  ])
  return { ...count, recent: recent.items, leaderboard: board.items }
}

export async function reservePreview({ inviter } = {}) {
  await report('start')
  const w = await checkWallet()
  if (!w.agentId) await fail('no_agent_id')
  const mine = await relay(`/api/reservation/status?address=${w.address}`)
  if (mine.reserved) {
    await report('already_reserved')
    return { alreadyReserved: true, status: mine }
  }
  if (!w.devMode.enabled) await fail('dev_mode_off')
  if (w.devMode.balanceExceeded) await fail('dev_balance_exceeded')
  const code = inviter ? await resolveInviter(inviter) : undefined
  let inviterInfo = null
  if (code) {
    const found = await relay(`/api/reservation/status?code=${encodeURIComponent(code)}`)
    if (!found.reserved) throw new GfError('bad_inviter', HINTS.bad_inviter.en)
    inviterInfo = { number: found.number, display: found.display, address: found.address }
  }
  const typed = await relay(`/api/reservation/typed-data${code ? `?inviter=${encodeURIComponent(code)}` : ''}`)
  let preview
  try {
    preview = await runBaw(['sign-message', 'preview', '--binanceChainId', BSC, '--signType', 'EIP712', '--message', signRequest(w.address, typed)])
  } catch (e) {
    await report('preview_failed')
    throw e
  }
  saveState(preview.requestId, { wallet: w.address, agentId: w.agentId, inviter: typed.message.inviter, at: Date.now() })
  return {
    alreadyReserved: false,
    requestId: preview.requestId,
    wallet: w.address,
    agentId: w.agentId,
    statement: typed.message.statement,
    inviter: inviterInfo,
    cost: 'free: no gas, no transfer, no token approval',
    risks: preview.risks ?? null,
    requireConfirmation: !!preview.requireConfirmation,
    expiresAt: preview.expiresAt ?? null,
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function reserveConfirm({ requestId }) {
  const state = loadState(requestId)
  let r
  if (state.orderId) r = await runBaw(['sign-message', 'result', '--order-id', state.orderId])
  else {
    try {
      r = await runBaw(['sign-message', 'execute', '--requestId', requestId])
    } catch (e) {
      await report('sign_failed')
      throw e
    }
  }
  const deadline = Date.now() + PENDING_WAIT_MS
  while (r.status === 'PENDING_CONFIRMATION') {
    saveState(requestId, { ...state, orderId: r.orderId })
    if (Date.now() > deadline) {
      await report('pending_timeout')
      throw new GfError('pending_timeout', HINTS.pending_timeout.en, { orderId: r.orderId })
    }
    await sleep(POLL_MS)
    r = await runBaw(['sign-message', 'result', '--order-id', r.orderId])
  }
  if (r.status === 'REJECTED') await fail('rejected')
  if (r.status === 'EXPIRED') await fail('expired')
  if (r.status !== 'COMPLETED' || !r.signature) {
    await report('sign_failed')
    throw new GfError('sign_failed', `unexpected sign-message status: ${r.status}`)
  }
  let result
  try {
    result = await relay('/api/reservation', {
      signature: r.signature,
      recovery: r.signatureRecovery ?? undefined,
      address: state.wallet,
      inviter: state.inviter && state.inviter !== ZERO ? state.inviter : undefined,
      name: state.agentId ?? undefined,
    })
  } catch (e) {
    await report('submit_failed')
    throw e
  }
  await report('reserved')
  rmSync(statePath(requestId), { force: true })
  return result
}

export function errorPayload(e) {
  const code = e instanceof GfError ? e.code : 'error'
  return { ok: false, code, message: e.message, hint: HINTS[code] ?? null, ...(e instanceof GfError ? e.extra : {}) }
}
