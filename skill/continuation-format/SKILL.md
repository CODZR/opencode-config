---
name: continuation-format
description: Standard format for presenting next steps after workflows.
---

# Continuation Format

Standard format for presenting next steps after completing a command or workflow.

## Core Structure

```
---

## ▶ Next Up

**{identifier}: {name}** — {one-line description}

{command to copy-paste}

*{session reset guidance if needed}*

---

**Also available:**
- {alternative option 1} — description
- {alternative option 2} — description

---
```

## Format Rules

1. **Always show what it is** — name + description, never just a command path
2. **Pull context from source** — ROADMAP.md for phases, PLAN.md `<objective>` for plans
3. **Command in inline code** — backticks, easy to copy-paste, renders as clickable link
4. **Session reset guidance** — include only if your workflow requires it
5. **"Also available" not "Other options"** — sounds more app-like
6. **Visual separators** — `---` above and below to make it stand out


## Pulling Context

### For phases (from ROADMAP.md):

```markdown
### Phase 2: Authentication
**Goal**: JWT login flow with refresh tokens
```

Extract: `**Phase 2: Authentication** — JWT login flow with refresh tokens`

### For plans (from ROADMAP.md):

```markdown
Plans:
- [ ] 02-03: Add refresh token rotation
```

Or from PLAN.md `<objective>`:

```xml
<objective>
Add refresh token rotation with sliding expiry window.

Purpose: Extend session lifetime without compromising security.
</objective>
```

Extract: `**02-03: Refresh Token Rotation** — Add /api/auth/refresh with sliding expiry`

## Anti-Patterns

### Don't: Command-only (no context)

- Missing name/description for the next step
- No explanation for why a session reset is needed (if applicable)
- "Other options" wording (use "Also available" instead)
- Fenced code blocks for commands (use inline formatting instead)
```
