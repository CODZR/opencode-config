---
name: codebase-map-arch
description: Templates and rules for mapping architecture and structure into .planning/codebase/.
---

## Purpose

Provide the templates and rules for mapping architecture patterns and directory structure.

## Outputs

- `.planning/codebase/ARCHITECTURE.md`
- `.planning/codebase/STRUCTURE.md`

## Hard Rules

- Only write the output files listed above.
- Always include real file paths in backticks (for example, `src/services/user.ts`).
- If something is not found, write "Not detected" or "Not applicable". Never leave blanks.
- Explicitly answer "Where to add new code" with concrete paths.
- Return confirmation only (file names + line counts), never paste document contents.

## Data Collection Checklist

- Entry points: `src/index.*`, `src/main.*`, `src/app.*`, `src/server.*`, `app/page.*`
- Directory layout and module boundaries
- Data flow examples (request -> service -> db)

## Templates

### ARCHITECTURE.md Template

```markdown
# Architecture

**Analysis Date:** [YYYY-MM-DD]

## Pattern Overview

**Overall:** [Pattern name]

**Key Characteristics:**
- [Characteristic 1]
- [Characteristic 2]
- [Characteristic 3]

## Layers

**[Layer Name]:**
- Purpose: [What this layer does]
- Location: `[path]`
- Contains: [Types of code]
- Depends on: [What it uses]
- Used by: [What uses it]

## Data Flow

**[Flow Name]:**

1. [Step 1]
2. [Step 2]
3. [Step 3]

**State Management:**
- [How state is handled]

## Key Abstractions

**[Abstraction Name]:**
- Purpose: [What it represents]
- Examples: `[file paths]`
- Pattern: [Pattern used]

## Entry Points

**[Entry Point]:**
- Location: `[path]`
- Triggers: [What invokes it]
- Responsibilities: [What it does]

## Error Handling

**Strategy:** [Approach]

**Patterns:**
- [Pattern 1]
- [Pattern 2]

## Cross-Cutting Concerns

**Logging:** [Approach]
**Validation:** [Approach]
**Authentication:** [Approach]

---

*Architecture analysis: [date]*
```

### STRUCTURE.md Template

```markdown
# Codebase Structure

**Analysis Date:** [YYYY-MM-DD]

## Directory Layout

```
[project-root]/
├── [dir]/          # [Purpose]
├── [dir]/          # [Purpose]
└── [file]          # [Purpose]
```

## Directory Purposes

**[Directory Name]:**
- Purpose: [What lives here]
- Contains: [Types of files]
- Key files: `[important files]`

## Key File Locations

**Entry Points:**
- `[path]`: [Purpose]

**Configuration:**
- `[path]`: [Purpose]

**Core Logic:**
- `[path]`: [Purpose]

**Testing:**
- `[path]`: [Purpose]

## Naming Conventions

**Files:**
- [Pattern]: [Example]

**Directories:**
- [Pattern]: [Example]

## Where to Add New Code

**New Feature:**
- Primary code: `[path]`
- Tests: `[path]`

**New Component/Module:**
- Implementation: `[path]`

**Utilities:**
- Shared helpers: `[path]`

## Special Directories

**[Directory]:**
- Purpose: [What it contains]
- Generated: [Yes/No]
- Committed: [Yes/No]

---

*Structure analysis: [date]*
```

## Confirmation Format

```
## Mapping Complete

**Focus:** arch
**Documents written:**
- `.planning/codebase/ARCHITECTURE.md` ({N} lines)
- `.planning/codebase/STRUCTURE.md` ({N} lines)

Ready for orchestrator summary.
```
