#!/usr/bin/env node
import { pathToFileURL } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { cardBuy, cardPreview, cardStatus } from '../skills/goldenfarm/scripts/card.mjs'
import { checkWallet, errorPayload, relay, reserveConfirm, reservePreview, reservationStatus, stats } from '../skills/goldenfarm/scripts/lib.mjs'

const INSTRUCTIONS = `GoldenFarm (淘金农场) is an on-chain farm game on BNB Chain. These tools reserve it with the user's Binance Agentic Wallet.
To reserve: call goldenfarm_reserve_preview, show the user the statement, inviter, wallet and any risks, and say it is free (no gas,
no transfer, no approval). Only after the user explicitly says yes, call goldenfarm_reserve_confirm with the requestId.
To buy Genesis Cards: call goldenfarm_card_preview, show the quantity, total BNB, the card contract, the paying wallet, the
expected card numbers and any risks. It spends real BNB: only after the user explicitly says yes, call goldenfarm_card_buy.
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
  const server = new McpServer({ name: 'goldenfarm', version: '0.1.2' }, { instructions: INSTRUCTIONS })
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
    'goldenfarm_card_preview',
    {
      title: 'Buy Genesis Cards: preview',
      description:
        'Step 1 of buying GoldenFarm Genesis Cards (0.01 BNB each, max 10 per wallet). Checks the sale and the wallet and asks the Binance Agentic Wallet to preview the purchase. Nothing is paid. Show the user the amount, contract and expected card numbers, and ask for an explicit yes before step 2.',
      inputSchema: {
        quantity: z.number().int().min(1).max(10).optional().describe('How many cards, 1 to 10; default 1'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    tool(({ quantity }) => cardPreview({ quantity: quantity ?? 1 })),
  )

  server.registerTool(
    'goldenfarm_card_buy',
    {
      title: 'Buy Genesis Cards: pay',
      description:
        'Step 2 of buying Genesis Cards. Spends BNB. Only call after the user explicitly confirmed this preview in this conversation. May wait up to 2 minutes for approval in the Binance App; on card_pending, call again after the user approves. Never pays twice for one preview.',
      inputSchema: {
        requestId: z.string().describe('requestId returned by goldenfarm_card_preview'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    tool(({ requestId }) => cardBuy({ requestId })),
  )

  server.registerTool(
    'goldenfarm_card_status',
    {
      title: 'Genesis Card sale',
      description: "The Genesis Card sale (open or not, sold, price) and how many cards a wallet bought and can still buy. Without arguments, checks the user's own Agentic Wallet.",
      inputSchema: {
        wallet: z.string().optional().describe('BSC wallet address, 0x…'),
      },
      annotations: readOnly,
    },
    tool(({ wallet }) => cardStatus({ wallet })),
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
