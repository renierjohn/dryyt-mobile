# UI Revamp — Design

Date: 2026-10-17
Branch: `feature-UI-revamp`

## Goal

Visual revamp of the app inspired by the GrabFood case study
(https://rifainasution.medium.com/case-study-ui-ux-research-plan-grabfood-7c1507e38939),
using the logo blue `#3B82F6` as the primary colour with a compatible palette.

## Scope

- **In:** theme tokens, shared components (all roles inherit), customer screen layouts, light + dark mode.
- **Out:** driver/owner layouts (they only inherit tokens/components), backend/API changes, new libraries.
- **Deferred (separate project):** case-study features — restaurant busyness indicator, stackable promos (delivery fee + store), "similar shops" recommendations.

## Approach

Extend the existing token system in `src/constants/theme.ts` and keep plain `StyleSheet` + `useTheme()`. No NativeWind, no `@expo/ui` restyle.

## 1. Tokens (`src/constants/theme.ts`)

Add tokens to both `Colors.light` and `Colors.dark`:

| token | light | dark |
|---|---|---|
| primary | `#3B82F6` | `#3B82F6` |
| primaryPressed | `#2563EB` | `#60A5FA` |
| primarySoft | `#EFF6FF` | `#172554` |
| onPrimary | `#FFFFFF` | `#FFFFFF` |
| text | `#0F172A` | `#F8FAFC` |
| textSecondary | `#64748B` | `#94A3B8` |
| background | `#F8FAFC` | `#020617` |
| backgroundElement | `#FFFFFF` | `#0F172A` |
| backgroundSelected | `#E2E8F0` | `#1E293B` |
| border | `#E2E8F0` | `#1E293B` |
| success | `#10B981` | `#10B981` |
| successSoft | `#ECFDF5` | `#052E16` |
| warning | `#F59E0B` | `#F59E0B` |
| warningSoft | `#FFFBEB` | `#451A03` |
| danger | `#EF4444` | `#EF4444` |
| dangerSoft | `#FEF2F2` | `#450A0A` |

`Brand` stays exported, re-pointed to the new values (`primary #3B82F6`, `success #10B981`, `warning #F59E0B`, `danger #EF4444`) so existing imports keep working.

Hard-coded colours move to tokens: `dropoff-map.tsx` pin colours (`PinColor` → `Brand`), `themed-text.tsx` `linkPrimary`, `animated-icon.tsx` / `.web.tsx` / `.module.css` gradient (`#60A5FA → #2563EB`). `face-camera.tsx` overlay colours (white/black alpha on camera feed) stay as-is.

Splash and Android adaptive icon backgrounds unchanged.

## 2. Shared components

- **Button** — variants `primary` (primary bg, onPrimary text), `secondary` (primarySoft bg, primary text), `outline` (transparent, 1px border, text colour), `danger` (danger bg, white). Pill radius (999), minHeight 52. Pressed: primary → primaryPressed bg; others opacity 0.8. Disabled opacity 0.5.
- **Card** — backgroundElement, 1px `border`, radius 16, light shadow (iOS shadow / Android elevation 1).
- **StatusBadge** — tones use `*Soft` bg + base text tokens; add `info` tone (primarySoft / primary).
- **TextField / AutocompleteField** — 1px `border`, radius 12, border becomes `primary` while focused.
- **ThemedText** — `title` 32/40, `subtitle` 24/32; `linkPrimary` uses `primary` token.
- **Tabs** (customer, driver, owner layouts) — selected label/icon `primary`, indicator `primarySoft`, background `backgroundElement`.
- **StatusTimeline** — active step `primary`, done steps `success`, pending `backgroundSelected`.

### New components (`src/components/`)

- **HeaderBand** — primary-coloured band under the safe area; props `title`, `subtitle?`, `children?`. Renders white logo + text in `onPrimary`.
- **ServiceTile** — pressable tile: icon in primarySoft circle, title, one-line body. Props `icon`, `title`, `body`, `onPress`.
- **BottomBar** — sticky bar pinned to the bottom safe area with top border; renders `children` (summary + button). Screens using it pass the bar to `Screen` via a new optional `footer` prop so the scroll content gets bottom padding.
- **Avatar** — circle with initial; props `name`, `size?`; primary bg, onPrimary text.

`Screen` gains `footer?: ReactNode` (renders BottomBar content outside the ScrollView) and `header?: ReactNode` (replaces the default logo header when given).

## 3. Customer screens (layout only, no logic changes)

- **Home** `(tabs)/index.tsx` — `HeaderBand` with "Hi, {name}" / "What do you need today?". `ServiceTile`s for Pickup (only if `PICKUP_ENABLED`) and Drop off; a lone tile spans full width. "Recent orders" section: first 3 items from `useHistory()` rendered as history cards, hidden when empty, "See all" link to Orders tab.
- **Pickup** `pickup.tsx` — Food/Laundry as `ServiceTile`s in a 2-column grid.
- **Stores** `stores.tsx` — store cards: icon in primarySoft circle, name, address, chevron. Empty state text when list is empty.
- **New order** `new-order.tsx` — store header card; menu rows with `StatusBadge` "Best seller" (info tone), discounted price + struck-through original; stepper buttons pill-shaped in primarySoft/primary. `footer` = items total + "Place order". Address/notes stay in scroll content.
- **Order detail** `order/[id].tsx` — status header card with badge; timeline; summary card; driver card with `Avatar`. Cancel as `danger` button at bottom.
- **Drop off detail** `dropoff/[id].tsx` — map wrapped in a rounded card, status header, fee row, driver card with `Avatar`; action buttons move to `footer`.
- **Orders tab** — restyled history cards: status badge right-aligned, amount bold, separators use `border`.
- **Profile** — `Avatar` header + grouped rows (shared `profile-screen.tsx`, so driver/owner inherit).

## Testing

- `tsc --noEmit`, `expo lint`, existing jest suites pass.
- Render tests for `HeaderBand`, `ServiceTile`, `BottomBar`, `Avatar` (render + key text/press).
- Manual visual check on Android, light and dark: Home, Pickup, Stores, New order, Order detail, Drop off detail, Orders, Profile; spot-check driver and owner screens for regressions.
