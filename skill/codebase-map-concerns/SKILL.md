---
name: codebase-map-concerns
description: Templates and rules for mapping risks and concerns into .planning/codebase/.
---

## Purpose

Provide the templates and rules for mapping technical debt and risks.

## Outputs

- `.planning/codebase/CONCERNS.md`

## Hard Rules

- Only write the output files listed above.
- Always include real file paths in backticks (for example, `src/services/user.ts`).
- If something is not found, write "Not detected" or "Not applicable". Never leave blanks.
- Every concern must include Files, Impact, and Fix approach.
- Return confirmation only (file names + line counts), never paste document contents.

## Data Collection Checklist

- TODO/FIXME/HACK comments
- Large or complex files
- Obvious stubs (`return null`, `return []`, etc.)

## Templates

### CONCERNS.md Template

```markdown
# Codebase Concerns

**Analysis Date:** [YYYY-MM-DD]

## Tech Debt

**[Area/Component]:**
- Issue: [What's the shortcut/workaround]
- Files: `[file paths]`
- Impact: [What breaks or degrades]
- Fix approach: [How to address it]

## Known Bugs

**[Bug description]:**
- Symptoms: [What happens]
- Files: `[file paths]`
- Trigger: [How to reproduce]
- Workaround: [If any]

## Security Considerations

**[Area]:**
- Risk: [What could go wrong]
- Files: `[file paths]`
- Current mitigation: [What's in place]
- Recommendations: [What should be added]

## Performance Bottlenecks

**[Slow operation]:**
- Problem: [What's slow]
- Files: `[file paths]`
- Cause: [Why it's slow]
- Improvement path: [How to speed up]

## Fragile Areas

**[Component/Module]:**
- Files: `[file paths]`
- Why fragile: [What makes it break easily]
- Safe modification: [How to change safely]
- Test coverage: [Gaps]

## Scaling Limits

**[Resource/System]:**
- Current capacity: [Numbers]
- Limit: [Where it breaks]
- Scaling path: [How to increase]

## Dependencies at Risk

**[Package]:**
- Risk: [What's wrong]
- Impact: [What breaks]
- Migration plan: [Alternative]

## Missing Critical Features

**[Feature gap]:**
- Problem: [What's missing]
- Blocks: [What can't be done]

## Test Coverage Gaps

**[Untested area]:**
- What's not tested: [Specific functionality]
- Files: `[file paths]`
- Risk: [What could break unnoticed]
- Priority: [High/Medium/Low]

---

*Concerns audit: [date]*
```

## Confirmation Format

```
## Mapping Complete

**Focus:** concerns
**Documents written:**
- `.planning/codebase/CONCERNS.md` ({N} lines)

Ready for orchestrator summary.
```
