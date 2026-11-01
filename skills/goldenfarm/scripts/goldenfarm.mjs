#!/usr/bin/env node
import { pathToFileURL } from 'node:url'
import { checkWallet, errorPayload, relay, reserveConfirm, reservePreview, reservationStatus, stats } from './lib.mjs'

function parseArgs(argv) {
  const [command, ...rest] = argv
  const flags = {}
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    const next = rest[i + 1]
    if (next === undefined || next.startsWith('--')) flags[key] = true
    else {
      flags[key] = next
      i++
    }
  }
  return { command, flags }
}

export async function run(argv) {
  const { command, flags } = parseArgs(argv)
  switch (command) {
    case 'check': {
      const wallet = await checkWallet()
      const reservation = await relay(`/api/reservation/status?address=${wallet.address}`)
      return { ...wallet, reservation }
    }
    case 'preview':
      return reservePreview({ inviter: typeof flags.inviter === 'string' ? flags.inviter : undefined })
    case 'confirm':
      if (typeof flags.requestId !== 'string') throw Object.assign(new Error('--request-id is required'), { code: 'bad_args' })
      return reserveConfirm({ requestId: flags.requestId })
    case 'status':
      return reservationStatus({
        wallet: typeof flags.wallet === 'string' ? flags.wallet : undefined,
        number: typeof flags.number === 'string' ? Number(flags.number) : undefined,
        name: typeof flags.name === 'string' ? flags.name : undefined,
      })
    case 'stats':
      return stats()
    default:
      throw Object.assign(new Error(`unknown command: ${command ?? ''}. Use check | preview | confirm | status | stats`), { code: 'bad_args' })
  }
}

export async function main(argv) {
  try {
    const result = await run(argv)
    process.stdout.write(JSON.stringify({ ok: true, ...result }) + '\n')
  } catch (e) {
    const payload = errorPayload(e)
    if (e && e.code === 'bad_args') payload.code = 'bad_args'
    process.stdout.write(JSON.stringify(payload) + '\n')
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2))
