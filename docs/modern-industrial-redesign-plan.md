# Modern industrial redesign — implementation plan

Status: planning only. Branch: `design/modern-industrial-dashboard`. No production deployment.

## Current repository findings
- Next.js 16 / React 19 / TypeScript / Tailwind 4; Cloudflare Vite/vinext deployment.
- `app/operations/page.tsx` authenticates users, checks database schema and renders `app/nca-console.tsx`.
- `app/nca-console.tsx` is the principal operations console, with navigation for overview, companies, fleet, daily production, breakdowns, maintenance, work orders, intelligence, reports, users and roles.
- `app/tmm-dashboard.tsx` is another dashboard component and contains static/placeholder data. Do not assume it is the production console.
- `app/globals.css` and `app/operations/navy.css` contain existing styles. `app/page.tsx` is the public marketing website, not the authenticated dashboard.
- Production has previously experienced Cloudflare Worker/D1 errors; avoid coupling UI migration to database or deployment changes.

## Product decisions
- Modern industrial: deep charcoal navigation, clean light workspaces, restrained emerald/amber/red signal colors, clear typography, responsive layouts.
- Preserve existing functionality, data, routes, API contracts, tenant isolation, and the two roles **Admin** and **Engineer**.
- Admin: administration, fleet configuration, OEM integrations, licensing and operational controls.
- Engineer: read/analysis dashboards, reliability trends, annotations and recommendations. Enforce permissions server-side, not only through navigation.
- Read-only management presentation view for authorised users, without adding a third operational role.
- OEM-first future: each vendor connector maps data into canonical telemetry schema. UI must show source, last sync, confidence/completeness and stale/no-data states.
- Never display fabricated live telemetry or imply predictive failures without a validated model. Existing historical/manual records remain available while integrations are incomplete.

## Phased work
1. **Audit**: trace `nca-console.tsx` components, role enforcement, current route/API dependencies, and report calculations. Record tests and production behavior. No changes to main.
2. **Design system**: introduce scoped design tokens and reusable app shell components; avoid global style regressions to public website.
3. **Executive overview**: KPI definitions (availability/utilisation denominators), filters by company/site/time, data freshness, risk queue, trend charts and downtime Pareto; meaningful empty/error/loading states.
4. **Fleet intelligence**: asset cards/table, status, source, last sync, OEM/manufacturer, fault events and drill-down; optional machine imagery with licensing and responsive fallbacks.
5. **Reliability and maintenance**: MTBF/MTTR only where event data supports them; fault chronology, recurring failures and priority actions.
6. **Management presentation**: full-screen, accessible, exportable read-only reporting from authorised data, with timestamps and units.
7. **OEM integration surface**: connection status/settings and standard field mappings; do not connect real APIs without mine consent and credentials.
8. **Verification**: typecheck/lint/build, unit/integration tests, visual responsive review, role-access tests, data isolation tests, Cloudflare Worker/D1 query budget and failure-state checks; stage preview, then explicit approval before merge/deploy.

## Technical approach
- Keep Next.js/React/TypeScript. Evaluate Apache ECharts for time series/Pareto and lightweight SVG for KPI indicators; use Three.js only if justified by a specific interaction/performance budget.
- Split monolithic console gradually into `components/industrial/`, `features/overview/`, `features/fleet/` and shared domain types, without changing API contracts.
- Use dynamic imports for heavyweight chart/3D modules, keyboard-accessible interactions, reduced-motion preferences, responsive mobile/tablet design and print styles.
- Do not use hardcoded demo metrics on authenticated operational screens.

## First implementation slice
- Document existing auth/role flows and chart data sources.
- Add a scoped design-token stylesheet and an isolated executive-overview component behind a non-production preview/feature flag.
- Compare preview against current functionality before replacing any route.
