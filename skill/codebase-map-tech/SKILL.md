---
name: codebase-map-tech
description: Templates and rules for mapping stack and integrations into .planning/codebase/.
---

## Purpose

Provide the templates and rules for mapping the technology stack and external integrations.

## Outputs

- `.planning/codebase/STACK.md`
- `.planning/codebase/INTEGRATIONS.md`

## Hard Rules

- Only write the output files listed above.
- Always include real file paths in backticks (for example, `src/services/user.ts`).
- If something is not found, write "Not detected" or "Not applicable". Never leave blanks.
- Do not guess versions. Only report versions you can verify from files.
- Do not include secrets or real credential values.
- Return confirmation only (file names + line counts), never paste document contents.

## Data Collection Checklist

- Language/runtime: `package.json`, `pyproject.toml`, `requirements.txt`, `go.mod`, `Cargo.toml`
- Build/test tooling: `tsconfig.json`, `vite.config.*`, `vitest.config.*`, `jest.config.*`
- External services: SDK imports and env vars (search for `process.env.*`, `.env.example`)

## Templates

### STACK.md Template

```markdown
# Technology Stack

**Analysis Date:** [YYYY-MM-DD]

## Languages

**Primary:**
- [Language] [Version] - [Where used]

**Secondary:**
- [Language] [Version] - [Where used]

## Runtime

**Environment:**
- [Runtime] [Version]

**Package Manager:**
- [Manager] [Version]
- Lockfile: [present/missing]

## Frameworks

**Core:**
- [Framework] [Version] - [Purpose]

**Testing:**
- [Framework] [Version] - [Purpose]

**Build/Dev:**
- [Tool] [Version] - [Purpose]

## Key Dependencies

**Critical:**
- [Package] [Version] - [Why it matters]

**Infrastructure:**
- [Package] [Version] - [Purpose]

## Configuration

**Environment:**
- [How configured]
- [Key configs required]

**Build:**
- [Build config files]

## Platform Requirements

**Development:**
- [Requirements]

**Production:**
- [Deployment target]

---

*Stack analysis: [date]*
```

### INTEGRATIONS.md Template

```markdown
# External Integrations

**Analysis Date:** [YYYY-MM-DD]

## APIs & External Services

**[Category]:**
- [Service] - [What it's used for]
  - SDK/Client: [package]
  - Auth: [env var name]

## Data Storage

**Databases:**
- [Type/Provider]
  - Connection: [env var]
  - Client: [ORM/client]

**File Storage:**
- [Service or "Local filesystem only"]

**Caching:**
- [Service or "None"]

## Authentication & Identity

**Auth Provider:**
- [Service or "Custom"]
  - Implementation: [approach]

## Monitoring & Observability

**Error Tracking:**
- [Service or "None"]

**Logs:**
- [Approach]

## CI/CD & Deployment

**Hosting:**
- [Platform]

**CI Pipeline:**
- [Service or "None"]

## Environment Configuration

**Required env vars:**
- [List critical vars]

**Secrets location:**
- [Where secrets are stored]

## Webhooks & Callbacks

**Incoming:**
- [Endpoints or "None"]

**Outgoing:**
- [Endpoints or "None"]

---

*Integration audit: [date]*
```

## Confirmation Format

```
## Mapping Complete

**Focus:** tech
**Documents written:**
- `.planning/codebase/STACK.md` ({N} lines)
- `.planning/codebase/INTEGRATIONS.md` ({N} lines)

Ready for orchestrator summary.
```
