# Runbear Skills

A Claude Code skill marketplace plugin.

## Skills

| Skill | Description |
|-------|-------------|
| `dispatch-http` | Start the Claude Agent HTTP API server (claude-agent-api) |

## Installation

```bash
/plugin marketplace add runbear/skills
/plugin install runbear-skills@runbear-skills
```

## Usage

```
/runbear-skills:dispatch-http
/runbear-skills:dispatch-http -- --port 8080
```

## Project Structure

```
.claude-plugin/
  marketplace.json          # Marketplace manifest
skills/
  dispatch-http/SKILL.md
```

## Adding New Skills

1. Create a new directory under `skills/`
2. Add a `SKILL.md` file with frontmatter (`description`) and instructions
3. Update this README

## License

MIT
