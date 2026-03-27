# Runbear Skills

Skills for exposing Claude Agent via HTTP and Slack.

## Plugins

### dispatch-http

| Skill | Description |
|-------|-------------|
| `dispatch-http` | Start an Express server that exposes Claude Code/Cowork via REST endpoints |
| `expose-http` | Expose the local dispatch-http server to the internet via a Cloudflare quick tunnel |

### dispatch-slack

| Skill | Description |
|-------|-------------|
| `dispatch-slack` | Start the Slack bot server that connects Claude Code to Slack via Socket Mode |
| `setup-slack` | Create and configure a Slack bot app with OAuth token rotation |

## Installation

```bash
/plugin marketplace add runbear-io/skills
/plugin install dispatch-http@runbear-skills
/plugin install dispatch-slack@runbear-skills
```

## Usage

```
/dispatch-http:dispatch-http
/dispatch-http:dispatch-http port 8080
/dispatch-http:expose-http

/dispatch-slack:setup-slack
/dispatch-slack:dispatch-slack
/dispatch-slack:dispatch-slack start /path/to/project
```

## Project Structure

```
.claude-plugin/
  marketplace.json
dispatch-http/
  skills/
    dispatch-http/
      SKILL.md
      package.json
      scripts/index.js
    expose-http/
      SKILL.md
dispatch-slack/
  skills/
    dispatch-slack/
      SKILL.md
      package.json
      scripts/index.js, slack-bot.js, token-manager.js, set-always-online.js
    setup-slack/
      SKILL.md
      scripts/create-slack-app.js, install-app.js, ...
      references/architecture.md, slack-app-setup.md, token-rotation.md
```

## Adding New Skills

1. Create a new directory under `<plugin>/skills/`
2. Add a `SKILL.md` file with frontmatter (`description`) and instructions
3. Add the skill path to `marketplace.json` under the plugin's `skills` array
4. Update this README

## License

MIT
