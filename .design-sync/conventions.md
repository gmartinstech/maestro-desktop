# Maestro Studio — how to build with this design system

This is the design system of **Maestro Studio**, a Windows/macOS Electron desktop app
(MartinsTech). Brand anchors: navy `#003566` and gold `#F5CC00`, Inter for UI, IBM Plex Mono
for anything the user might copy. It is a desktop app, not a website — prefer dense, panelled
layouts over marketing-page spacing.

## 1. Always wrap in ThemeProvider

`ThemeProvider` installs the whole token layer (it renders `.mds-root` and sets `data-theme`).
**Without it, components fall back to the browser's default serif font and lose the page
background** — everything looks broken. Wrap once, at the top.

```jsx
<ThemeProvider theme="light" fullHeight>
  <AppShell titleBar={<TitleBar platform="win" />} sidebar={<Sidebar>…</Sidebar>}>
    <PageHeader title="Dashboard" />
  </AppShell>
</ThemeProvider>
```

`theme="dark"` swaps every colour token on the same element — nothing else to change. In dark
mode the navy accent becomes a lighter azure automatically (navy is unreadable on a dark
surface), and the gold logo tile inverts to gold-with-dark-ink.

## 2. Style with props first, `var(--mds-*)` second — never invent class names

Components are **prop-driven**: `variant`, `tone`, `size`, `padding`, `active`, `collapsed`.
There is no utility-class system — do not write Tailwind-style classes, they resolve to nothing.

For your own layout glue, use `Stack` / `Grid` (which spend the 4px spacing scale) and, when you
must write CSS, reference these token families — all defined in the stylesheet, all theme-aware:

| Family | Tokens |
|---|---|
| Surfaces | `--mds-bg-page` `--mds-bg-surface` `--mds-bg-elevated` `--mds-bg-secondary` `--mds-bg-inverse` |
| Text | `--mds-text-primary` `--mds-text-secondary` `--mds-text-tertiary` `--mds-text-muted` `--mds-text-inverse` `--mds-text-ghost` |
| Accent / brand | `--mds-accent` `--mds-accent-hover` `--mds-accent-pressed` `--mds-brand-navy` `--mds-brand-gold` |
| Status | `--mds-success` `--mds-warning` `--mds-error` `--mds-info` (each with a `-bg` pair) |
| Borders / depth | `--mds-border-subtle` `--mds-border-medium` `--mds-border-strong` `--mds-shadow-sm/-md/-lg` |
| Radius | `--mds-radius-sm` … `--mds-radius-xl` (all 8px), `--mds-radius-full` |
| Spacing | `--mds-space-1` `-2` `-3` `-4` `-5` `-6` `-8` `-10` (4px → 40px) |
| Type | `--mds-font-sans` `--mds-font-mono` |
| Chrome | `--mds-titlebar-height` (38px) `--mds-sidebar-width` (260px) `--mds-window-controls-gutter` (138px) `--mds-traffic-light-gutter` (78px) |

Colour rules that matter: **gold always takes dark ink, never white** — it is a highlight, at
most one per screen (`Button variant="accent"`). Navy is the default action colour
(`variant="primary"`). Status colours come only from the status tokens.

## 3. Desktop chrome is real, and its numbers are not negotiable

`AppShell` is the window frame: `TitleBar` on top (38px, never scrolls), `Sidebar` rail on the
left (260px expanded, 56px collapsed — the app boots collapsed), scrolling content on the right,
plus `toasts` and `overlay` slots. Give the shell a fixed height; the content pane scrolls, the
frame does not.

Set `TitleBar platform` correctly: `"win"` reserves 138px on the right for the Windows
minimise/maximise/close overlay, `"mac"` reserves 78px on the left for the traffic lights.
Getting it wrong puts your controls underneath the OS buttons.

`Modal` and `CommandPalette` scrims are `position: absolute` — mount them inside `AppShell`
(via `overlay`), not at the document root.

## 4. Where the truth lives

- `_ds/<folder>/styles.css` — imports `fonts.css` and `_ds_bundle.css`; **every token and class
  is defined in `_ds_bundle.css`**. Read it before writing any CSS.
- `components/<group>/<Name>/<Name>.prompt.md` — per-component usage and full prop contract.
- `components/<group>/<Name>/<Name>.d.ts` — the typed API.
- Screen templates `DashboardScreen`, `SettingsScreen`, `AgentChatScreen` are **reference
  layouts to copy from**, not components to nest in a real app.

## 5. An idiomatic screen

```jsx
<ThemeProvider theme="light" fullHeight>
  <AppShell
    titleBar={<TitleBar platform="win" leading={<MaestroLogo size={22} />} title="Maestro Studio" />}
    sidebar={
      <Sidebar footer={<SidebarItem label="Settings" icon={<Icon name="settings" />} />}>
        <SidebarItem label="Dashboard" icon={<Icon name="dashboard" />} active />
        <SidebarItem label="Agents" icon={<Icon name="agent" />} count={7} />
      </Sidebar>
    }
    toasts={<Toast tone="success" message="Workflow finished in 48s" actionLabel="View run" />}
  >
    <PageHeader
      title="Agents"
      subtitle="Seven agents are configured on this machine."
      actions={<Button icon={<Icon name="plus" size={15} />}>New agent</Button>}
    />
    <Grid columns={4}>
      <StatCard label="Runs (24h)" value="184" delta="+12.4%" trend="up" />
    </Grid>
    <Card title="Recent runs" subtitle="Last 24 hours" padding="flush">
      <Table columns={columns} rows={rows} />
    </Card>
  </AppShell>
</ThemeProvider>
```

Note the idioms: a flush `Card` wrapping a `Table`, numeric table columns marked `numeric` so
they right-align in tabular mono, `Icon` at 15–16px inside buttons and nav rows, and realistic
agent/run content rather than placeholder text.
