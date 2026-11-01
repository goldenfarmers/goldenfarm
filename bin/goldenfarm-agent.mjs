#!/usr/bin/env node
const [command, ...rest] = process.argv.slice(2)
if (command === 'mcp') {
  const { startLocalMcp } = await import('../src/mcp.mjs')
  await startLocalMcp()
} else {
  const { main } = await import('../skills/goldenfarm/scripts/goldenfarm.mjs')
  await main([command, ...rest].filter((a) => a !== undefined))
}
