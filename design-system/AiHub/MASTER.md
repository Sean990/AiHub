# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** AiHub
**Generated:** 2026-05-13 16:24:29
**Category:** Developer Tool / IDE

---

## Global Rules

### Color Palette

| Role | Hex | CSS Variable |
|------|-----|--------------|
| Primary | `#2563EB` | `--primary` |
| Running | `#16A34A` | `--success` |
| Warning | `#D97706` | `--warning` |
| Danger | `#DC2626` | `--danger` |
| Background | `#F3F6FA` | `--background` |
| Surface | `#FFFFFF` | `--card` |
| Text | `#0F172A` | `--foreground` |

**Color Notes:** Local AI route control console. Use neutral surfaces for dense data and reserve saturated color for active, running, selected, warning, and danger states.

### Typography

- **Heading Font:** Inter
- **Body Font:** Inter
- **Mood:** minimal, clean, swiss, functional, neutral, professional
- **Google Fonts:** [Inter + Inter](https://fonts.google.com/share?selection.family=Inter:wght@300;400;500;600;700)

**CSS Import:**
```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
```

### Spacing Variables

| Token | Value | Usage |
|-------|-------|-------|
| `--space-2xs` | `4px` | Micro offsets, label margins |
| `--space-xs` | `6px` | Tight icon gaps |
| `--space-sm` | `8px` | Standard touch-safe gaps |
| `--space-md` | `12px` | Compact card/form padding |
| `--space-lg` | `16px` | Panel padding and page gaps |
| `--space-xl` | `20px` | Primary surface padding |
| `--space-2xl` | `24px` | Desktop modal/page padding |
| `--space-3xl` | `32px` | Scroll container bottom padding |
| `--gap-page` | `20px` desktop, `16px` tablet, `12px` compact | Main section rhythm |
| `--control-height` | `32px` | Buttons and icon buttons |
| `--input-height` | `34px` | Inputs, selects, search fields |

### Responsive Layout Rules

- Desktop: sidebar `224px`, page padding `16-24px`, Dashboard hero uses two columns.
- <=1280px: metrics compress from five columns to three; Dashboard hero stacks to one column.
- <=1060px: two-column work areas, chat, and settings collapse to one column.
- <=820px: sidebar collapses to `64px`, navigation labels hide, cards/forms/tables use one-column grids.
- <=640px: topbar can grow vertically, status bar becomes a two-column grid, toolbars stack full-width actions.
- <=520px: sidebar becomes `56px`, page padding drops to `12px`, primary action buttons and modal actions stretch for touch.
- The topbar and service status bar form one continuous top control area: shared background blur, shared horizontal padding, no card-style inset, and the service status bar remains sticky at the top of the scrollable workspace.

### Shadow Depths

| Level | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | Subtle lift |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.1)` | Cards, buttons |
| `--shadow-lg` | `0 10px 15px rgba(0,0,0,0.1)` | Modals, dropdowns |
| `--shadow-xl` | `0 20px 25px rgba(0,0,0,0.15)` | Hero images, featured cards |

---

## Component Specs

### Buttons

```css
/* Primary Button */
.btn-primary {
  background: #2563EB;
  color: white;
  height: 32px;
  padding: 0 14px;
  border-radius: 10px;
  font-weight: 500;
  transition: background 140ms ease, box-shadow 140ms ease;
  cursor: pointer;
}

.btn-primary:hover {
  background: #1D4ED8;
}

/* Secondary Button */
.btn-secondary {
  background: #FFFFFF;
  color: #0F172A;
  border: 1px solid #D7DEE8;
  height: 32px;
  padding: 0 14px;
  border-radius: 10px;
  font-weight: 500;
  transition: background 140ms ease, border-color 140ms ease;
  cursor: pointer;
}
```

### Cards

```css
.card {
  background: #FFFFFF;
  border: 1px solid #D7DEE8;
  border-radius: 14px;
  padding: 18px;
  box-shadow: var(--shadow-sm);
  transition: border-color 140ms ease, box-shadow 140ms ease;
}

.card:hover {
  border-color: #C4CDD9;
  box-shadow: var(--shadow-md);
}
```

### Inputs

```css
.input {
  height: 34px;
  padding: 0 11px;
  border: 1px solid #D7DEE8;
  border-radius: 10px;
  font-size: 13px;
  transition: border-color 140ms ease, box-shadow 140ms ease;
}

.input:focus {
  border-color: #2563EB;
  outline: none;
  box-shadow: 0 0 0 3px rgb(37 99 235 / 18%);
}
```

### Modals

```css
.modal-overlay {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(6px);
}

.modal {
  background: #FFFFFF;
  border: 1px solid #D7DEE8;
  border-radius: 18px;
  padding: 20px;
  box-shadow: var(--shadow-lg);
  max-width: 500px;
  width: 90%;
}
```

---

## Style Guidelines

**Style:** Local Route Control Console

**Keywords:** Desktop control surface, provider switcher, dense status cards, clear route hierarchy, neutral surfaces, restrained accents, explicit risk states

**Best For:** Developer tools, local gateways, AI subscription routers, operational dashboards, settings-heavy desktop apps

**Key Effects:** 140-200ms hover transitions, no scale-based layout shift, status pills, active route highlight, confirmation dialogs for destructive or sensitive operations

### Page Pattern

**Pattern Name:** Control Console Shell

- **Primary Task:** Determine gateway state, active route, exposed endpoint, and next operation within the first viewport.
- **CTA Placement:** Topbar and dashboard control surface; only one primary action per task group.
- **Section Order:** 1. Gateway control surface, 2. Provider switch panel, 3. Core metrics, 4. Recent route and logs, 5. Detail tables or forms.

---

## Anti-Patterns (Do NOT Use)

- ❌ All cards with identical visual weight
- ❌ Destructive actions without confirmation
- ❌ Copying third-party protected assets, icons, screenshots, or exact layouts

### Additional Forbidden Patterns

- ❌ **Emojis as icons** — Use SVG icons (Heroicons, Lucide, Simple Icons)
- ❌ **Missing cursor:pointer** — All clickable elements must have cursor:pointer
- ❌ **Layout-shifting hovers** — Avoid scale transforms that shift layout
- ❌ **Low contrast text** — Maintain 4.5:1 minimum contrast ratio
- ❌ **Instant state changes** — Always use transitions (140-200ms)
- ❌ **Invisible focus states** — Focus states must be visible for a11y

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons from consistent icon set (Heroicons/Lucide)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No content hidden behind fixed navbars
- [ ] No horizontal scroll on mobile
