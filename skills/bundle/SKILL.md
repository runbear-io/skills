---
description: Bundle the project and selected skills into .shipyard/build/ for distribution
---

Bundle the project with selected skills into `.shipyard/build/`.

## Steps

- [ ] Step 1: Prepare the build folder
- [ ] Step 2: Copy project files to build folder
- [ ] Step 3: Let user select additional skills to bundle
- [ ] Step 4: Copy selected skill folders to build folder

### Step 1: Prepare the build folder

Create `.shipyard/build/` under the project root. If it already exists, remove all its contents first.

```bash
rm -rf "$PROJECT_ROOT/.shipyard/build" && mkdir -p "$PROJECT_ROOT/.shipyard/build"
```

### Step 2: Copy project files to build folder

Use `rsync` to copy all files from the project root to `.shipyard/build/`, excluding:
- `.shipyard/` (the build output itself)
- `.claude/settings.local.json` (Claude local scope settings)
- Any files matched by `.gitignore`

```bash
rsync -a --exclude='.shipyard' --filter=':- .gitignore' --exclude='.claude/settings.local.json' "$PROJECT_ROOT/" "$PROJECT_ROOT/.shipyard/build/"
```

After copying, list what was copied so the user can see the project files included.

### Step 3: Let user select additional skills to bundle

Read `.claude-plugin/marketplace.json` to find the project's own skills (listed in the `plugins[].skills` array). These are **project scope skills** and are always included.

Then scan the user's installed skill/plugin directories for any **other** skills not in this project. Present a checklist of those external skills and ask the user which ones to include.

To find installed skills, check:
- `~/.claude/plugins/` for globally installed plugins
- Look at `marketplace.json` files in those plugin directories

Display to the user:
```
Project skills (always included):
  - ./skills/dispatch-http
  - ./skills/expose-http

Other available skills:
  [ ] <skill-name> — <description>
  [ ] <skill-name> — <description>
```

Ask the user to confirm which additional skills they want bundled.

### Step 4: Copy selected skill folders to build folder

For each selected external skill, copy its entire folder into `.shipyard/build/.claude/skills/`.

```bash
cp -R <source-skill-path> "$PROJECT_ROOT/.shipyard/build/.claude/skills/<skill-name>"
```

After copying, list the final contents of `.shipyard/build/` and confirm the bundle is ready.
