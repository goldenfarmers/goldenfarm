import { GfError, HINTS, RELAY, checkWallet, loadState, removeState, runBaw, saveState, sleep } from './lib.mjs'

export const CARD = process.env.GOLDENFARM_CARD || '0x5EBC0388A54c340Dc9ADEeb724E93E9a64183093'
const BSC_RPC = process.env.GOLDENFARM_BSC_RPC || 'https://bsc-dataseed.bnbchain.org'
const WAIT_MS = Number(process.env.GOLDENFARM_PENDING_WAIT_MS || 120000)
const POLL_MS = Number(process.env.GOLDENFARM_POLL_MS || 3000)

const PRICE_WEI = 10n ** 16n
const GAS_WEI = 5n * 10n ** 14n
const MAX_PER_WALLET = 10
const CAP = 6000
const BOUGHT = '0xedba86fd2b22962d534e70ad9b0ff8730de46f636146f2bab6a72cbb1ebbcc53'
const SEL = {
  saleStart: '0xab0bcc41',
  saleEnd: '0xc10b9358',
  totalMinted: '0xa2309ff8',
  paused: '0x5c975abb',
  boughtBy: '0x5e3ffee6',
  buy: '0xd96a094a',
}

const word = (n) => BigInt(n).toString(16).padStart(64, '0')
const addressWord = (a) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0')
const hex = (n) => `0x${BigInt(n).toString(16)}`
const cardNo = (id) => `#${String(id).padStart(4, '0')}`

export function bnb(wei) {
  const s = BigInt(wei).toString().padStart(19, '0')
  const frac = s.slice(-18).replace(/0+$/, '')
  return frac ? `${s.slice(0, -18)}.${frac}` : s.slice(0, -18)
}

async function rpc(method, params) {
  let res
  try {
    res = await fetch(BSC_RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
  } catch {
    throw new GfError('rpc_unreachable', `cannot reach ${BSC_RPC}`)
  }
  const body = await res.json().catch(() => ({}))
  if (body.error || !('result' in body)) throw new GfError('rpc_error', body.error?.message || `HTTP ${res.status}`)
  return body.result
}

const read = async (data) => BigInt(await rpc('eth_call', [{ to: CARD, data }, 'latest']))

export async function saleState(wallet) {
  const [start, end, minted, paused, bought, balance, block] = await Promise.all([
    read(SEL.saleStart),
    read(SEL.saleEnd),
    read(SEL.totalMinted),
    read(SEL.paused),
    wallet ? read(SEL.boughtBy + addressWord(wallet)) : 0n,
    wallet ? rpc('eth_getBalance', [wallet, 'latest']).then(BigInt) : 0n,
    rpc('eth_getBlockByNumber', ['latest', false]),
  ])
  const now = Number(BigInt(block.timestamp))
  const phase =
    minted >= BigInt(CAP) ? 'soldout' : now < Number(start) ? 'before' : now >= Number(end) ? 'ended' : paused ? 'paused' : 'open'
  return {
    phase,
    startsAt: Number(start),
    endsAt: Number(end),
    minted: Number(minted),
    cap: CAP,
    priceBnb: bnb(PRICE_WEI),
    maxPerWallet: MAX_PER_WALLET,
    bought: Number(bought),
    left: Math.max(0, Math.min(MAX_PER_WALLET - Number(bought), CAP - Number(minted))),
    balanceWei: balance,
    block: Number(BigInt(block.number)),
  }
}

function publicSale(s) {
  const { balanceWei, block, ...rest } = s
  return { ...rest, balanceBnb: bnb(balanceWei) }
}

function cardsOf(logs, wallet) {
  const ids = []
  let txHash = null
  for (const log of logs) {
    if (String(log.address).toLowerCase() !== CARD.toLowerCase() || log.topics?.[0] !== BOUGHT) continue
    if (wallet && log.topics[1] !== `0x${addressWord(wallet)}`) continue
    const data = String(log.data).replace(/^0x/, '')
    const first = Number(BigInt(`0x${data.slice(0, 64)}`))
    const quantity = Number(BigInt(`0x${data.slice(64, 128)}`))
    for (let i = 0; i < quantity; i++) ids.push(first + i)
    txHash = log.transactionHash ?? txHash
  }
  return { ids, txHash }
}

function share(ids) {
  const text = ids.length > 1 ? `${cardNo(ids[0])}–${cardNo(ids[ids.length - 1])}` : cardNo(ids[0])
  return {
    zh: `我的 AI 帮我抢到了淘金农场创世卡 ${text}，收获 +5%。${RELAY}/zh/presale/`,
    en: `My AI got me GoldenFarm Genesis Card ${text}: Harvest +5%. ${RELAY}/presale/`,
  }
}

function done(state, txHash, ids) {
  return {
    bought: true,
    quantity: state.quantity,
    cards: ids.length ? ids.map(cardNo) : null,
    txHash,
    bscscan: txHash ? `https://bscscan.com/tx/${txHash}` : `https://bscscan.com/address/${state.wallet}`,
    share: ids.length ? share(ids) : null,
  }
}

export async function cardPreview({ quantity = 1 } = {}) {
  const q = Number(quantity)
  if (!Number.isInteger(q) || q < 1 || q > MAX_PER_WALLET) throw new GfError('bad_quantity', HINTS.bad_quantity.en)
  const w = await checkWallet()
  const sale = await saleState(w.address)
  const base = { wallet: w.address, agentId: w.agentId, card: CARD, sale: publicSale(sale) }
  if (sale.phase !== 'open') return { open: false, ...base }
  if (sale.left === 0) {
    const code = sale.bought >= MAX_PER_WALLET ? 'wallet_limit' : 'sold_out'
    throw new GfError(code, HINTS[code].en)
  }
  if (q > sale.left) throw new GfError('wallet_limit', HINTS.wallet_limit.en, { left: sale.left })
  if (!w.devMode.enabled) throw new GfError('dev_mode_off', HINTS.dev_mode_off.en)
  if (w.devMode.balanceExceeded) throw new GfError('dev_balance_exceeded', HINTS.dev_balance_exceeded.en)
  const value = PRICE_WEI * BigInt(q)
  if (sale.balanceWei < value + GAS_WEI)
    throw new GfError('low_balance', HINTS.low_balance.en, { needBnb: bnb(value + GAS_WEI), haveBnb: bnb(sale.balanceWei) })
  let preview
  try {
    preview = await runBaw([
      'contract-call',
      'preview',
      '--binanceChainId',
      '56',
      '--from',
      w.address,
      '--to',
      CARD,
      '--value',
      value.toString(),
      '--inputData',
      SEL.buy + word(q),
    ])
  } catch (e) {
    const code = String(e.extra?.bawCode ?? '')
    if (code === '351803') throw new GfError('risk_blocked', HINTS.risk_blocked.en, e.extra)
    if (code === '351802') throw new GfError('dev_mode_off', HINTS.dev_mode_off.en, e.extra)
    throw e
  }
  saveState(preview.requestId, { kind: 'card', wallet: w.address, quantity: q, boughtBefore: sale.bought, block: sale.block, at: Date.now() })
  return {
    open: true,
    ...base,
    requestId: preview.requestId,
    quantity: q,
    totalBnb: bnb(value),
    totalWei: value.toString(),
    expectedCards: [cardNo(sale.minted + 1), cardNo(sale.minted + q)],
    simulation: preview.simulationResult ?? null,
    risks: preview.risks ?? null,
    requireConfirmation: !!preview.requireConfirmation,
    expiresAt: preview.expiresAt ?? null,
  }
}

async function receiptOf(txHash, deadline) {
  for (;;) {
    const r = await rpc('eth_getTransactionReceipt', [txHash])
    if (r) return r
    if (Date.now() > deadline) return null
    await sleep(POLL_MS)
  }
}

async function findPurchase(wallet, fromBlock) {
  try {
    const logs = await rpc('eth_getLogs', [
      { address: CARD, fromBlock: hex(fromBlock), toBlock: 'latest', topics: [BOUGHT, `0x${addressWord(wallet)}`] },
    ])
    return cardsOf(logs.slice(-1), wallet)
  } catch {
    return { ids: [], txHash: null }
  }
}

export async function cardBuy({ requestId }) {
  const state = loadState(requestId)
  if (state.kind !== 'card') throw new GfError('unknown_request', HINTS.unknown_request.en)
  let current = state
  if (!state.orderId) {
    const r = await runBaw(['contract-call', 'execute', '--requestId', requestId])
    current = { ...state, orderId: r.orderId ?? 'pending', txHash: r.txHash ?? null }
    saveState(requestId, current)
    if (!r.txHash && r.status !== 'PENDING_CONFIRMATION')
      throw new GfError('buy_failed', r.message || `unexpected contract-call status: ${r.status}`)
  }
  const deadline = Date.now() + WAIT_MS
  if (current.txHash) {
    const receipt = await receiptOf(current.txHash, deadline)
    if (!receipt) throw new GfError('card_pending', HINTS.card_pending.en, { txHash: current.txHash })
    removeState(requestId)
    if (receipt.status !== '0x1') throw new GfError('buy_failed', HINTS.buy_failed.en, { txHash: current.txHash })
    return done(current, current.txHash, cardsOf(receipt.logs ?? [], current.wallet).ids)
  }
  for (;;) {
    const sale = await saleState(current.wallet)
    if (sale.bought > current.boughtBefore) {
      const found = await findPurchase(current.wallet, current.block)
      removeState(requestId)
      return done(current, found.txHash, found.ids)
    }
    if (Date.now() > deadline) throw new GfError('card_pending', HINTS.card_pending.en, { orderId: current.orderId })
    await sleep(POLL_MS)
  }
}

export async function cardStatus({ wallet } = {}) {
  const address = wallet || (await checkWallet()).address
  const sale = await saleState(address)
  return { wallet: address, card: CARD, sale: publicSale(sale), presale: `${RELAY}/presale/` }
}
