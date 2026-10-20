# Retail inMotion Portal+ — notes for contributors and AI assistants

## Edition

This is the Retail inMotion internal edition of Portal+. It must not contain Marketplace branding; the **Brand check** workflow fails the build if it does. Identifiers shared with other apps (issue/project property keys, provider ids) live in `src/portal-plus-contract.js`, the only file the brand check exempts.

Deploys: merging to `main` reaches the sandbox only. The work site is deployed only by the manual **Deploy to Retail inMotion work site** workflow (Forge production). Never deploy from a local Forge CLI: the app belongs to the Retail inMotion Forge account.

## UI consistency (@retailinmotion/ui)

This app uses the shared Retail inMotion UI kit (`@retailinmotion/ui`, repo RiM-ui).

- No hardcoded colours in app CSS. Use `var(--nq-*)` tokens. `npm run check:ui` must pass (part of `npm test`).
- New screens use the kit's classes: `nq-header`, `nq-tabs`, `nq-card`, `nq-notice`, `nq-empty`, `nq-loading`, `nq-table`, `nq-btn`, `nq-field`, `nq-actionbar`, `nq-footer`.
- Every Custom UI resource calls `enableTheme(view)` from `@retailinmotion/ui/theme` at start-up.
- If a pattern is missing, add it to RiM-ui and bump the pinned commit. Don't restyle it locally.

Portal+ specifics:

- CSS and HTML are hand-written in `static/*/dist/` (tracked). `npm run build` copies `retailinmotion-ui.css` into both dist folders. Link it before the app's own stylesheets.
- The customer portal is white-label. The top bar gradient, the logo tile and the customer accent (`--brand`) are intentional fixed colours, listed in `retailinmotion-ui.json`. Everything else uses tokens.
