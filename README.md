# Runbear Agent Skills

Skills for exposing Claude Agent as HTTP APIs.

## Skills

| Skill | Description |
|-------|-------------|
| `dispatch-http` | Start an Express server that exposes Claude Code/Cowork via REST endpoints |
| `expose-http` | Expose the local dispatch-http server to the internet via a Cloudflare quick tunnel |

## Installation

```bash
/plugin marketplace add runbear/skills
/plugin install http-skills@runbear-agent-skills
```

## Usage

```
/http-skills:dispatch-http
/http-skills:dispatch-http port 8080
/http-skills:expose-http
```

## Project Structure

```
.claude-plugin/
  marketplace.json
skills/
  dispatch-http/
    SKILL.md
    package.json
    scripts/index.js
  expose-http/
    SKILL.md
```

## Adding New Skills

1. Create a new directory under `skills/`
2. Add a `SKILL.md` file with frontmatter (`description`) and instructions
3. Add the skill path to `marketplace.json` under the plugin's `skills` array
4. Update this README

## License

MIT
