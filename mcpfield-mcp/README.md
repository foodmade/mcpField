# mcpfield-mcp

MCP server for [MCP Field](https://mcpfield.com), a directory of MCP servers and agent Skills. Add it to Claude Code, Codex, Gemini CLI, Cursor or any MCP client, then just ask your agent:

- “Install all my saved Skills on this computer”
- “Find an MCP server that can drive a browser and save it”
- “List my saved MCP servers and write the Codex config”

## Setup

1. Sign in at [mcpfield.com](https://mcpfield.com) and create an API key at [mcpfield.com/console/keys](https://mcpfield.com/console/keys). The full key is shown only once.
2. Add the server to your agent, passing the key as `MCPFIELD_API_KEY`.

**Claude Code**

```sh
claude mcp add mcpfield --scope user \
  --env MCPFIELD_API_KEY=<YOUR_API_KEY> \
  -- npx -y mcpfield-mcp
```

**Codex** (`~/.codex/config.toml`)

```toml
[mcp_servers.mcpfield]
command = "npx"
args = ["-y", "mcpfield-mcp"]
env = { MCPFIELD_API_KEY = "<YOUR_API_KEY>" }
```

**Gemini CLI** (`~/.gemini/settings.json`), **Cursor** (`~/.cursor/mcp.json`) and most other clients

```json
{
  "mcpServers": {
    "mcpfield": {
      "command": "npx",
      "args": ["-y", "mcpfield-mcp"],
      "env": { "MCPFIELD_API_KEY": "<YOUR_API_KEY>" }
    }
  }
}
```

Requires Node.js 18 or later. `search` and `get_mcp_config` work without a key; the favorites tools need one.

## Tools

| Tool | What it does |
| --- | --- |
| `search` | Search MCP servers and Skills by keyword |
| `list_favorites` | List the items you saved on MCP Field |
| `add_favorite` / `remove_favorite` | Save or remove an MCP server or Skill |
| `install_skill` | Install Skills into local agents with the [skills.sh CLI](https://github.com/vercel-labs/skills) (`npx skills add`), globally or into a project. Skills that failed a security audit are skipped unless you confirm |
| `get_mcp_config` | Generate the install command or config snippet for an MCP server in Claude Code, Codex, Gemini CLI, Cursor, VS Code, Claude Desktop or Windsurf. It doesn’t edit any files |

## Environment variables

| Variable | Default | |
| --- | --- | --- |
| `MCPFIELD_API_KEY` | | API key from mcpfield.com/console/keys |
| `MCPFIELD_LOCALE` | `en` | Language for descriptions: `en`, `zh` or `ja` |
| `MCPFIELD_API_URL` | `https://mcpfield.com` | Site to talk to |

## Keys and security

- A key can read and change all your saved items. Keep it like a password; revoke it in the console if it leaks.
- Keys expire after 30 days, 90 days, 1 year or never, as chosen when created. Each key is limited to 60 requests per minute.
- The console shows when each key was last used and by which agent.

## 中文说明

MCP Field（mcpfield.com）的 MCP 服务。在 [控制台](https://mcpfield.com/console/keys) 创建 API 密钥，按上面的配置加到 Claude Code、Codex、Gemini CLI 等 Agent 里，就可以让 Agent 搜索 MCP 服务和 Skill、管理你的收藏、把 Skill 装到本机、生成 MCP 服务的配置。

## License

MIT
