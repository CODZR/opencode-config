---
name: load-plan-context
description: Load .planning context and summarize constraints for the current task
argument-hint: "<task description>"
tools:
  - read
  - glob
  - grep
  - bash
  - question
---

<objective>
Load relevant .planning context and summarize constraints for the current task.

Scope the depth of reading based on task difficulty and relevance.
</objective>

<context>
Task: $ARGUMENTS

If no task is provided, ask the user for:
- Task description
- Perceived difficulty (low/medium/high)
- Whether it touches multiple modules or external integrations
</context>

<process>
1. Check if .planning/ exists
2. Determine reading scope based on task complexity
3. Read the most relevant .planning documents
4. Summarize constraints and recommendations
</process>

<decision_guide>
Use this guide to pick which documents to read:

**Always read if present:**
- .planning/STATE.md (current project context)
- .planning/codebase/STRUCTURE.md (where to place files)
- .planning/codebase/CONVENTIONS.md (naming/style rules)

**Read for medium complexity tasks:**
- .planning/codebase/ARCHITECTURE.md (layers and data flow)
- .planning/codebase/TESTING.md (test expectations)

**Read for high complexity or cross-cutting tasks:**
- .planning/REQUIREMENTS.md (scope boundaries)
- .planning/ROADMAP.md (phase constraints)
- .planning/codebase/INTEGRATIONS.md (external services)
- .planning/codebase/CONCERNS.md (risks/fragile areas)

If task is unclear, ask the user to clarify before reading more.
</decision_guide>

<output_format>
Provide a concise summary with these sections:

1. **Task Understanding** (1-2 sentences)
2. **File Placement Rules** (from STRUCTURE.md)
3. **Code Conventions** (from CONVENTIONS.md)
4. **Architecture Constraints** (from ARCHITECTURE.md if read)
5. **Testing Expectations** (from TESTING.md if read)
6. **Integrations/Risks** (from INTEGRATIONS.md/CONCERNS.md if read)
7. **Scope Boundaries** (from REQUIREMENTS.md/ROADMAP.md if read)
</output_format>

<steps>
<step name="check_planning">
Check for .planning directory:

```bash
ls -la .planning 2>/dev/null
```

If not found, respond:
"No .planning/ directory found. Run /map-codebase to generate codebase docs or create .planning/ manually."
</step>

<step name="get_task">
If $ARGUMENTS is empty, ask:

"What's the task you want to work on, and how complex is it (low/medium/high)?"

Wait for user response, then continue.
</step>

<step name="read_docs">
Read the required documents based on decision_guide. Use @-notation when available.

Examples:
- @.planning/STATE.md
- @.planning/codebase/STRUCTURE.md
- @.planning/codebase/CONVENTIONS.md

Skip any files that do not exist.
</step>

<step name="summarize">
Summarize using output_format. Keep it concise and oriented to immediate execution.
</step>
</steps>
