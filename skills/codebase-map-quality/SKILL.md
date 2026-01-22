---
name: codebase-map-quality
description: Templates and rules for mapping conventions and testing into .planning/codebase/.
---

## Purpose

Provide the templates and rules for mapping coding conventions and testing patterns.

## Outputs

- `.planning/codebase/CONVENTIONS.md`
- `.planning/codebase/TESTING.md`

## Hard Rules

- Only write the output files listed above.
- Always include real file paths in backticks (for example, `src/services/user.ts`).
- If something is not found, write "Not detected" or "Not applicable". Never leave blanks.
- Conventions must be prescriptive (how to follow the pattern).
- Testing must include at least one real test file path and a short structure summary.
- Return confirmation only (file names + line counts), never paste document contents.

## Data Collection Checklist

- Lint/format config: `.eslintrc*`, `eslint.config.*`, `.prettierrc*`, `biome.json`
- Test runner config: `jest.config.*`, `vitest.config.*`, `playwright.config.*`
- Test files: `**/*.test.*`, `**/*.spec.*`

## Templates

### CONVENTIONS.md Template

```markdown
# Coding Conventions

**Analysis Date:** [YYYY-MM-DD]

## Naming Patterns

**Files:**
- [Pattern observed]

**Functions:**
- [Pattern observed]

**Variables:**
- [Pattern observed]

**Types:**
- [Pattern observed]

## Code Style

**Formatting:**
- [Tool used]
- [Key settings]

**Linting:**
- [Tool used]
- [Key rules]

## Import Organization

**Order:**
1. [First group]
2. [Second group]
3. [Third group]

**Path Aliases:**
- [Aliases used]

## Error Handling

**Patterns:**
- [How errors are handled]

## Logging

**Framework:** [Tool or "console"]

**Patterns:**
- [When/how to log]

## Comments

**When to Comment:**
- [Guidelines observed]

**JSDoc/TSDoc:**
- [Usage pattern]

## Function Design

**Size:** [Guidelines]

**Parameters:** [Pattern]

**Return Values:** [Pattern]

## Module Design

**Exports:** [Pattern]

**Barrel Files:** [Usage]

---

*Convention analysis: [date]*
```

### TESTING.md Template

```markdown
# Testing Patterns

**Analysis Date:** [YYYY-MM-DD]

## Test Framework

**Runner:**
- [Framework] [Version]
- Config: `[config file]`

**Assertion Library:**
- [Library]

**Run Commands:**
```bash
[command]              # Run all tests
[command]              # Watch mode
[command]              # Coverage
```

## Test File Organization

**Location:**
- [Pattern: co-located or separate]

**Naming:**
- [Pattern]

**Structure:**
```
[Directory pattern]
```

## Test Structure

**Suite Organization:**
```typescript
[Show actual pattern from codebase]
```

**Patterns:**
- [Setup pattern]
- [Teardown pattern]
- [Assertion pattern]

## Mocking

**Framework:** [Tool]

**Patterns:**
```typescript
[Show actual mocking pattern from codebase]
```

**What to Mock:**
- [Guidelines]

**What NOT to Mock:**
- [Guidelines]

## Fixtures and Factories

**Test Data:**
```typescript
[Show pattern from codebase]
```

**Location:**
- [Where fixtures live]

## Coverage

**Requirements:** [Target or "None enforced"]

**View Coverage:**
```bash
[command]
```

## Test Types

**Unit Tests:**
- [Scope and approach]

**Integration Tests:**
- [Scope and approach]

**E2E Tests:**
- [Framework or "Not used"]

## Common Patterns

**Async Testing:**
```typescript
[Pattern]
```

**Error Testing:**
```typescript
[Pattern]
```

---

*Testing analysis: [date]*
```

## Confirmation Format

```
## Mapping Complete

**Focus:** quality
**Documents written:**
- `.planning/codebase/CONVENTIONS.md` ({N} lines)
- `.planning/codebase/TESTING.md` ({N} lines)

Ready for orchestrator summary.
```
