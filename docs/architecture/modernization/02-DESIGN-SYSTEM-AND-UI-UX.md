# 02 — Design System and UI/UX

> Defines the shared design system, platform-specific adaptations, and
> interaction pattern strategy.
>
> **Master reference:** `00-MASTER-ARCHITECTURE.md` Section 4.1 (Shared vs. Platform-Specific).

---

## 1. Current UI Analysis

### 1.1 Existing Framework Stack

| Layer             | Technology           | Location                       |
|-------------------|----------------------|--------------------------------|
| Component library | HeroUI (NextUI fork) | `@heroui/react`, `@heroui/styles` |
| Styling           | Tailwind CSS 4       | `tailwindcss ^4.3.3`           |
| Icons             | Phosphor, Solar, React Icons | `@phosphor-icons/react`, `@solar-icons/react` |
| Rendering engine  | PixiJS 8             | `pixi.js ^8.14.0`             |
| Animation         | Motion (Framer)      | `motion ^12.23.24`            |
| Drag and drop     | dnd-kit + dnd-timeline | `@dnd-kit/core`, `dnd-timeline` |
| Layout panels     | react-resizable-panels | `^3.0.6`                     |
| Positioning       | react-rnd            | `^10.5.2`                      |
| Color picker      | Custom `color-picker.tsx` | `src/components/ui/`       |
| Emoji picker      | emoji-picker-react    | `^4.16.1`                     |

### 1.2 Existing Components (src/components/ui/)

26 shared components:
`accordion`, `account-avatar`, `audio-level-meter`, `button`, `card`,
`choice-group`, `color-picker`, `content-clamp`, `dialog`, `dropdown-menu`,
`icons`, `input`, `item-content`, `label`, `popover`, `select`, `separator`,
`skeleton`, `slider`, `switch`, `tabs`, `toast`, `toggle-group`, `toggle`.

### 1.3 Theme System

- `ThemeContext.tsx` provides light/dark theme switching.
- CSS custom properties via Tailwind for color tokens.
- Platform detection: `data-platform="macos"` or `"other"` on `<html>`.
- Window-type routing: `data-window-type` controls per-window styling.

---

## 2. Design Token Architecture

### 2.1 Token Categories

```
packages/ui/src/tokens/
├── colors.ts          # Semantic color tokens
├── typography.ts      # Font families, sizes, weights, line-heights
├── spacing.ts         # Spacing scale, border-radius, padding
├── shadows.ts         # Elevation and shadow tokens
├── motion.ts          # Animation durations, easings
└── index.ts           # Token bundle
```

### 2.2 Color Token System

| Token                    | Light            | Dark              | Usage                |
|--------------------------|------------------|-------------------|----------------------|
| `--color-background`     | `#fafafa`        | `#0a0a0b`         | Page background      |
| `--color-surface`        | `#ffffff`        | `#141416`         | Card/panel surfaces  |
| `--color-foreground`     | `#171717`        | `#fafafa`         | Primary text         |
| `--color-muted`          | `#737373`        | `#a3a3a3`         | Secondary text       |
| `--color-accent`         | `#6366f1`        | `#818cf8`         | Interactive accent   |
| `--color-destructive`    | `#ef4444`        | `#f87171`         | Error/destructive    |
| `--color-recording`      | `#ef4444`        | `#f87171`         | Recording indicator  |
| `--color-editor-bg`      | Custom           | Custom            | Editor workspace     |
| `--color-timeline-bg`    | Custom           | Custom            | Timeline surface     |

*Tokens are extracted from current Tailwind configuration and HeroUI theme.*
*Exact values require verification from the running application.*

### 2.3 Typography

| Token                  | Desktop           | Web              | Mobile             |
|------------------------|-------------------|------------------|---------------------|
| `--font-sans`          | System font stack | System font stack | Platform default    |
| `--font-mono`          | JetBrains Mono    | JetBrains Mono   | System monospace    |
| `--text-xs`            | 12px              | 12px             | 13px (touch target) |
| `--text-sm`            | 14px              | 14px             | 15px               |
| `--text-base`          | 16px              | 16px             | 16px               |
| `--text-lg`            | 18px              | 18px             | 18px               |

---

## 3. Shared Components Strategy

### 3.1 Component Classification

| Component          | Shared? | Platform Adaptation                     |
|--------------------|---------|------------------------------------------|
| Button             | Yes     | Touch targets larger on mobile           |
| Dialog             | Yes     | Sheet on mobile, modal on desktop/web    |
| Slider             | Yes     | Touch-friendly handle on mobile          |
| Select             | Yes     | Native picker on mobile                  |
| Dropdown menu      | Yes     | Action sheet on mobile                   |
| Tabs               | Yes     | Bottom tabs on mobile                    |
| Input              | Yes     | None                                     |
| Toast              | Yes     | Position differs per platform            |
| Card               | Yes     | None                                     |
| Toggle             | Yes     | None                                     |
| Color picker       | Yes     | Simplified on mobile                     |
| Audio level meter  | Yes     | None                                     |
| Accordion          | Yes     | None                                     |
| Popover            | Yes     | Touch positioning on mobile              |

### 3.2 Platform-Specific Components

| Component              | Desktop Only | Web Only | Mobile Only |
|------------------------|--------------|----------|-------------|
| HUD overlay            | Yes          | —        | —           |
| Source selector         | Yes          | —        | —           |
| Countdown overlay       | Yes          | —        | —           |
| Update toast            | Yes          | —        | —           |
| Traffic lights padding  | macOS only   | —        | —           |
| System tray menu        | Yes          | —        | —           |
| File save dialog        | Yes          | Custom   | Share sheet  |
| Title bar controls      | Yes          | —        | —           |
| Bottom navigation       | —            | —        | Yes         |
| Touch gesture controls  | —            | —        | Yes         |

---

## 4. Desktop Interaction Patterns

- **Keyboard shortcuts:** Full shortcut system via `ShortcutsContext.tsx`.
  Space = play/pause, arrow keys = frame step, Ctrl+S = save, etc.
- **Mouse interactions:** Right-click context menus, drag-and-drop timeline,
  resizable panels, tooltips on hover.
- **Window management:** Multi-window (HUD, editor, countdown, source selector).
  macOS traffic light awareness. Transparent overlays.
- **Menu bar:** Application menu with File, Edit, View entries.

---

## 5. Web Interaction Patterns

- **Keyboard shortcuts:** Preserved from desktop (same `ShortcutsContext`).
  Avoid conflicts with browser shortcuts (Ctrl+W, Ctrl+T, etc.).
- **Mouse interactions:** Same as desktop. No right-click context menu
  conflicts (use `preventDefault` where needed).
- **Single window:** No multi-window. HUD and source selector are not
  applicable. Editor is the primary view.
- **File handling:** Use File System Access API where available, fallback to
  standard `<a download>` for exports.
- **Responsive:** Minimum width 1024px for full editor, simplified layout
  below that threshold.

---

## 6. Mobile Interaction Patterns

- **Touch gestures:** Pinch-to-zoom on timeline, swipe for clip navigation,
  long press for context menu.
- **Bottom navigation:** Tabs for Dashboard, Editor, Settings.
- **Reduced toolbar:** Compact settings panel, expandable sections.
- **Touch targets:** Minimum 44x44px for all interactive elements.
- **No keyboard shortcuts:** Rely on on-screen controls.
- **Simplified timeline:** Single-track view, larger touch targets.
- **No HUD/overlay:** Not applicable on mobile.

---

## 7. Responsive Layout Strategy

### 7.1 Editor Layout Breakpoints

| Breakpoint   | Width     | Layout                              |
|--------------|-----------|--------------------------------------|
| Desktop      | >= 1280px | Full editor: preview + sidebar + timeline |
| Tablet       | 768-1279px | Condensed: collapsible sidebar        |
| Mobile       | < 768px   | Stacked: preview above, controls below |

### 7.2 Existing Layout System

The editor uses `react-resizable-panels` for the desktop layout
(`EditorShell.tsx` in `src/components/video-editor/layout/`).

- This is suitable for desktop and web.
- Mobile requires a separate layout composition using stacked views.
- The resizable panel library should remain for desktop/web.
- Mobile uses a platform-specific layout wrapper.

---

## 8. Accessibility

### 8.1 Current State

- React Aria integration (`react-aria ^3.52.1`) for accessible primitives.
- HeroUI provides accessible component foundations.
- No audit evidence of WCAG compliance level in the repository.

### 8.2 Target Requirements

| Requirement                    | Priority | Notes                              |
|--------------------------------|----------|------------------------------------|
| Keyboard navigation (all)     | High     | Already partially implemented      |
| Screen reader labels           | High     | Verify all interactive elements    |
| Color contrast (WCAG AA)       | High     | Audit design tokens                |
| Focus indicators               | High     | Ensure visible focus rings         |
| Reduced motion support         | Medium   | `prefers-reduced-motion` query     |
| Touch target sizes (mobile)    | High     | 44x44px minimum                    |
| RTL support (Arabic locale)    | Medium   | Already has `ar` locale            |

---

## 9. UI Consistency Rules

1. **No platform-specific colors.** All colors come from design tokens.
2. **No hardcoded font sizes.** All typography uses token scale.
3. **No inline styles for layout.** Use Tailwind utility classes or CSS modules.
4. **No duplicate components.** Use `packages/ui/` components everywhere.
5. **Platform adaptation via CSS custom properties,** not conditional rendering
   of different components.
6. **Dark/light theme must work identically** across desktop, web, and mobile.
7. **Icons from a single icon set** (consolidate Phosphor + Solar + React Icons
   into one preferred set, or maintain a unified mapping layer).

---

## 10. Migration Strategy

### Phase 1: Extract Design Tokens
- Audit current Tailwind config and HeroUI theme.
- Create `packages/ui/src/tokens/` with extracted values.
- Replace hardcoded values in components with token references.

### Phase 2: Extract UI Components
- Move 26 UI components to `packages/ui/src/components/`.
- Update all import paths.
- Verify component tests still pass.

### Phase 3: HeroUI Evaluation
- Determine if HeroUI is compatible with React Native (it is not).
- Decision: Keep HeroUI for desktop/web, use React Native components
  that match the design tokens for mobile.
- Alternative: Replace HeroUI with Radix UI primitives + custom styles
  for better cross-platform compatibility.

### Phase 4: Mobile Adaptations
- Create mobile-specific layout wrappers.
- Add touch gesture handlers.
- Implement platform-adaptive dialogs and pickers.
