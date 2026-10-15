# Local agent settings

<!--
Copy this file to AGENTS.local.md at the repo root and fill it in.
AGENTS.local.md is git-ignored: it holds settings for your machine only.
Claude Code loads it through CLAUDE.md; root AGENTS.md tells other agents to read it.
-->

## Browser automation

- **Allowed Chrome deviceId:** `<your-device-id>`
- **Forbidden deviceIds (other extensions connected to your account):** `<other-device-id>`, or *none*

Run `list_connected_browsers` from an agent session to see the deviceIds connected to your account.
The rules for using them are in root `AGENTS.md → Browser automation`.
