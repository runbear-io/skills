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

Then collect all other available skills from these sources:
- Check `~/.claude/plugins/` for globally installed plugins and look at their `marketplace.json` files
- Check `$PROJECT_ROOT/.claude/skills/` for local scope skills (skill folders with a `SKILL.md` file)
- Collect all skills that are NOT already listed as project scope skills
- Exclude all skills belonging to the `shipyard` plugin (i.e., this plugin's own skills like `bundle`)

Tell the user which project scope skills are always included, then use the `AskUserQuestion` tool with `multiSelect: true` to let the user pick additional skills:

```json
{
  "questions": [
    {
      "question": "Which additional skills do you want to bundle?",
      "header": "Skills",
      "multiSelect": true,
      "options": [
        { "label": "<skill-name>", "description": "<skill description from SKILL.md frontmatter>" }
      ]
    }
  ]
}
```

Build the `options` array dynamically from the discovered non-project skills. Each option's `label` should be the skill name and `description` should come from the skill's `SKILL.md` frontmatter `description` field.

If there are no additional skills available, skip this step and inform the user.

### Step 4: Copy selected skill folders to build folder

For each selected external skill, copy its entire folder into `.shipyard/build/.claude/skills/`.

```bash
cp -R <source-skill-path> "$PROJECT_ROOT/.shipyard/build/.claude/skills/<skill-name>"
```

After copying, list the final contents of `.shipyard/build/` and confirm the bundle is ready.
