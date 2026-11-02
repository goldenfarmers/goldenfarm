# goldenfarm-agent

GoldenFarm is a farm game on BNB Chain: plant, harvest, fight off drought, pests and weeds, and build your farm up level by
level. It hasn't launched yet. Reserve now and claim the Early Bird Scarecrow (+1% harvest) when it opens.

Let your AI reserve for you and you're an AI farmer, with the AI edition scarecrow. Bring 3 AI farmers and get a Genesis Card,
for the first 1,000 players. Or let your AI buy one: 0.01 BNB, Harvest +5%, 10 days only.

This package lets your agent do it with your Binance Agentic Wallet. Reserving is free: no gas, no transfer, no approval.

## What you need

- Node.js 18+
- The Binance Agentic Wallet CLI, signed in (`npx skills add binance/binance-skills-hub/skills/binance-web3/binance-agentic-wallet`)
- An Agent ID (a free `.ai` name in the Binance App), with Developer Mode on (Agentic Wallet → Settings)

## Install

Skill:

```bash
npx skills add goldenfarmers/goldenfarm --skill goldenfarm
```

MCP, for Claude Desktop, Cursor and the like:

```json
{ "mcpServers": { "goldenfarm": { "command": "npx", "args": ["-y", "goldenfarm-agent", "mcp"] } } }
```

## Use

> Reserve GoldenFarm for me
>
> Reserve GoldenFarm for me, inviter lucky.ai
>
> Buy a GoldenFarm Genesis Card for me

Your agent shows you what it's about to sign or pay and waits for your OK. A reservation signs one line,
`Reserve GoldenFarm · 预约淘金农场`, plus the inviter's address. A card purchase pays the exact BNB you confirmed to the Genesis
Card contract and nothing else. It never touches keys.

Step names (never addresses) are reported so we can see where people get stuck; `GOLDENFARM_NO_STATS=1` turns that off.
Commands are listed in [SKILL.md](skills/goldenfarm/SKILL.md). MIT license.
