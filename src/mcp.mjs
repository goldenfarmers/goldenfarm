#!/usr/bin/env node
import { pathToFileURL } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { checkWallet, errorPayload, relay, reserveConfirm, reservePreview, reservationStatus, stats } from '../skills/goldenfarm/scripts/lib.mjs'

const INSTRUCTIONS = `GoldenFarm (淘金农场) is an on-chain farm game on BNB Chain. These tools reserve it with the user's Binance Agentic Wallet.
To reserve: call goldenfarm_reserve_preview, show the user the statement, inviter, wallet and any risks, and say it is free (no gas,
no transfer, no approval). Only after the user explicitly says yes, call goldenfarm_reserve_confirm with the requestId.
On ok:false, tell the user the hint in their language; for baw_error show the message exactly as returned.`

const text = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] })

function tool(fn) {
  return async (args) => {
    try {
      return text({ ok: true, ...(await fn(args ?? {})) })
    } catch (e) {
      return { ...text(errorPayload(e)), isError: true }
    }
  }
}

export function localMcp() {
  const server = new McpServer({ name: 'goldenfarm', version: '0.1.0' }, { instructions: INSTRUCTIONS })
  const readOnly = { readOnlyHint: true, openWorldHint: true }

  server.registerTool(
    'goldenfarm_check',
    {
      title: 'Check my wallet',
      description: "Check the user's Binance Agentic Wallet for GoldenFarm: signed in, BSC address, Agent ID, Developer Mode, and whether it already reserved.",
      annotations: readOnly,
    },
    tool(async () => {
      const wallet = await checkWallet()
      return { ...wallet, reservation: await relay(`/api/reservation/status?address=${wallet.address}`) }
    }),
  )

  server.registerTool(
    'goldenfarm_reserve_preview',
    {
      title: 'Reserve GoldenFarm: preview',
      description:
        'Step 1 of reserving GoldenFarm. Checks the wallet and asks the Binance Agentic Wallet to preview the reservation signature. Nothing is signed. Show the user the result and ask for an explicit yes before step 2.',
      inputSchema: {
        inviter: z.string().optional().describe('Inviter named by the user: .ai name, reservation number or 0x address'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    tool(({ inviter }) => reservePreview({ inviter })),
  )

  server.registerTool(
    'goldenfarm_reserve_confirm',
    {
      title: 'Reserve GoldenFarm: sign',
      description:
        'Step 2 of reserving GoldenFarm. Only call after the user explicitly confirmed the preview in this conversation. Signs the reservation statement with the Binance Agentic Wallet (free, no gas) and submits it. May wait up to 2 minutes for approval in the Binance App; on pending_timeout, call again after the user approves.',
      inputSchema: {
        requestId: z.string().describe('requestId returned by goldenfarm_reserve_preview'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    tool(({ requestId }) => reserveConfirm({ requestId })),
  )

  server.registerTool(
    'goldenfarm_status',
    {
      title: 'Reservation status',
      description:
        "A GoldenFarm reservation and its invite progress (5 AI farmers = 1 Genesis Card). Without arguments, checks the user's own Agentic Wallet.",
      inputSchema: {
        wallet: z.string().optional().describe('BSC wallet address, 0x…'),
        number: z.number().int().positive().optional().describe('Reservation number'),
        name: z.string().optional().describe('.ai name, e.g. lucky.ai'),
      },
      annotations: readOnly,
    },
    tool((args) => reservationStatus(args)),
  )

  server.registerTool(
    'goldenfarm_stats',
    {
      title: 'Reservation stats',
      description: 'How many people reserved GoldenFarm, how many are AI farmers, Genesis Cards left for invites, latest reservations, invite leaderboard.',
      annotations: readOnly,
    },
    tool(() => stats()),
  )

  return server
}

export async function startLocalMcp() {
  await localMcp().connect(new StdioServerTransport())
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await startLocalMcp()
