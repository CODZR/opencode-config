# Minimal Aesthetic Toast Spec (Stack + Hover-Aware Dismiss)

## 1) Scope and Payload Contract

- Runtime target: custom local toast channel (Hammerspoon runtime), not macOS Notification Center UI.
- Payload fields rendered: `message` (primary line), `subtitle` (secondary line).
- Optional static app label: `OpenCode` as tiny top label; no buttons, no action links, no progress UI.
- Visual goal: minimal, low-distraction, polished; readable at a glance within 2 seconds.

## 2) Visual Tokens (Implementation Defaults)

### 2.1 Typography

| Token | Value |
|---|---|
| `font.family.primary` | `"Avenir Next", "PingFang SC", "Hiragino Sans GB", sans-serif` |
| `font.size.label` | `11px` |
| `font.size.message` | `14px` |
| `font.size.subtitle` | `12px` |
| `font.weight.label` | `500` |
| `font.weight.message` | `600` |
| `font.weight.subtitle` | `400` |
| `lineHeight.label` | `14px` |
| `lineHeight.message` | `20px` |
| `lineHeight.subtitle` | `16px` |
| `letterSpacing.label` | `0.2px` |
| `letterSpacing.message` | `0px` |
| `letterSpacing.subtitle` | `0px` |

### 2.2 Spacing and Size

| Token | Value |
|---|---|
| `toast.width` | `320px` |
| `toast.minHeight` | `72px` |
| `toast.padding.x` | `14px` |
| `toast.padding.y` | `12px` |
| `toast.content.gap` | `4px` |
| `stack.gap` | `10px` |
| `stack.margin.top` | `20px` |
| `stack.margin.right` | `20px` |

### 2.3 Shape, Border, Shadow, Opacity

| Token | Value |
|---|---|
| `radius.toast` | `12px` |
| `border.width` | `1px` |
| `border.color` | `rgba(255, 255, 255, 0.16)` |
| `shadow.level.default` | `0 8px 24px rgba(0, 0, 0, 0.24)` |
| `shadow.level.hover` | `0 10px 28px rgba(0, 0, 0, 0.28)` |
| `opacity.background` | `0.92` |
| `opacity.label` | `0.62` |
| `opacity.subtitle` | `0.78` |

### 2.4 Color Tokens

| Token | Value |
|---|---|
| `color.surface` | `#171A1F` |
| `color.text.primary` | `#F5F7FA` |
| `color.text.secondary` | `#D0D5DD` |
| `color.label` | `#B8C0CC` |
| `color.accent.bar` | `#7AA2F7` |

## 3) Layout Rules

- Stack anchor: top-right corner.
- Toast order: newest on top, older items flow downward.
- Internal layout (top to bottom): optional app label (`OpenCode`) -> `message` -> `subtitle`.
- Left accent: `2px` vertical bar using `color.accent.bar` at `40%` opacity for subtle identity.
- Text clamp: `message` max 2 lines, `subtitle` max 1 line; overflow uses ellipsis.

## 4) Motion and Interaction Constraints

### 4.1 Motion (minimal only)

| Transition | Duration | Easing | Properties |
|---|---|---|---|
| enter | `140ms` | `ease-out` | opacity `0 -> 1`, translateY `-6px -> 0` |
| reflow (after add/remove) | `120ms` | `ease-out` | translateY position only |
| hover in/out | `100ms` | `linear` | shadow level + background opacity `0.92 <-> 0.96` |

- No spring, bounce, blur animation, or scale pulse.

### 4.2 Stack Policy (deterministic)

- `maxVisible = 5` (default, required).
- Overflow eviction: when a new toast arrives and visible count is already `5`, evict the oldest visible toast first, then insert the new toast.
- Burst behavior: rapid notifications always remain as independent cards (no grouping, no collapsing into one toast).

## 5) Hover-Aware Dismiss Lifecycle

- Initial state on show: visible with no dismiss timer running.
- `hover enter`: cancel pending dismiss timer immediately.
- `hover leave`: start a new `3000ms` dismiss timer.
- If `hover enter` occurs during countdown: timer is canceled; toast remains visible.
- If `hover leave` occurs again after re-enter: restart full `3000ms` timer (no residual time carryover).
- On timer expiry: remove toast and reflow remaining stack immediately.

## 6) State Diagram (Deterministic)

```text
NEW
  -> (render) VISIBLE

VISIBLE
  -> (hover_enter) HOVERED
  -> (evicted_by_overflow) DISMISSED

HOVERED
  -> (hover_leave) LEAVE_PENDING_3000MS

LEAVE_PENDING_3000MS
  -> (hover_enter) HOVERED   [cancel timer]
  -> (timer_expire) DISMISSED
```

## 7) QA State Table (Machine-Verifiable Expectations)

| Case ID | Preconditions | Event/Input | Expected State | Expected Timers | Expected Stack |
|---|---|---|---|---|---|
| `S1` | 0 toasts | add 1 toast | `VISIBLE` | none | count=1 |
| `S2` | 5 toasts visible (`t1` oldest -> `t5` newest) | add `t6` | `t1` dismissed, `t6` visible | none | count=5, order: `t6,t5,t4,t3,t2` |
| `S3` | toast `tA` in `VISIBLE` | hover_enter(`tA`) | `HOVERED` | timer for `tA` absent | unchanged |
| `S4` | toast `tA` in `HOVERED` | hover_leave(`tA`) | `LEAVE_PENDING_3000MS` | timer for `tA` = 3000ms active | unchanged |
| `S5` | `tA` has active leave timer, 1200ms elapsed | hover_enter(`tA`) | `HOVERED` | timer canceled | unchanged |
| `S6` | `tA` has active leave timer | wait >=3000ms (no enter) | `DISMISSED` | timer removed | count-1 and reflow |
| `S7` | 7 notify events within 300ms | add `t1..t7` | only 5 visible | none by default | order: `t7,t6,t5,t4,t3` |

## 8) Non-Goals for This Spec

- No runtime code implementation in this task.
- No flashy effects, large transforms, or prolonged animation choreography.
- No ambiguity tokens (every token above is numeric/measurable and implementation-ready).
