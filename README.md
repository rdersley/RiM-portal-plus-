# Retail inMotion Portal+

A branded customer workspace inside the Jira Service Management portal on the Retail inMotion work site: dashboard, requests, reports, guides and self-service, per customer, on top of JSM.

This is Retail inMotion's internal edition. It is its own Forge app (owned by the Retail inMotion Forge account), is not licensed through the Marketplace, and is deployed only by this repository's workflows.

## Capabilities

**Customer workspace**
- Branded dashboard in the help center portal header: brand name, uploaded logo, accent colour, search, optional white-label top bar.
- Counters (open, awaiting customer, awaiting support), Action Centre for requests waiting on the customer.
- Services as a searchable card grid, importable from the project's JSM portal groups; announcements, quick links.
- My Requests: search, filters, sorting, saved views, up to 8 configurable columns, SLA status per request.
- Request detail: configured read-only and editable fields, SLA, progress timeline, admin-enabled Close and Escalate.
- Customer reports by period; CSV and Excel export of the customer's visible requests (up to 1,000).
- Guides & documents library per customer, linking to knowledge base articles.
- Page layout presets, first-visit view, and a "More" menu when the tabs don't fit.

**Multi-customer**
- Experiences per JSM organisation, each with its own branding, services, guides and settings.
- Several help centers on one shared project, each showing its customer's experience.
- Optional narrowing of requests by a dropdown custom field (for example Customer = Ryanair).

**Companion apps**
- Approvals from Retail inMotion Smart Approval Manager and My Assets from Retail inMotion Asset Manager. The shared identifiers are in `src/portal-plus-contract.js`.
- Extra menu tabs that admins add by hand.

**Settings**
- Backup & restore of a project's Portal+ settings (download / upload a JSON file).

## Security model

Portal+ reads Jira with app permissions so customers never see a consent prompt, and enforces the customer boundary itself on every server call: requests the customer reported or that are shared with their organisations, in the current project, optionally narrowed further. Help center addresses choose branding only; organisation membership decides access. Writes happen only for admin-enabled edits and transitions, with an internal audit comment.

## Deploying

| What | How |
| --- | --- |
| Sandbox (retailinmotion-sandbox1) | Merge to `main`. **Remote Forge QA** deploys Forge development and upgrades the sandbox install. |
| Work site (retailinmotion.atlassian.net) | Run **Deploy to Retail inMotion work site** and type `DEPLOY`. Deploys Forge **production**. |

The work site must run from the production environment, and the app's Developer console → Distribution must be set to **Sharing**. Without both, Forge shows every customer an "Allow access" box.

First-time setup (once, by the owner of the Retail inMotion Forge account):
1. Add the `FORGE_EMAIL` and `FORGE_API_TOKEN` repository secrets.
2. Run **Register Forge app**. It registers the app and commits its id to `manifest.yml`.
3. Set Distribution to **Sharing** in the developer console.

## Development

```bash
npm install
npm test            # build, UI style check, behaviour tests
forge lint
```

Behaviour tests run the real resolvers against an in-memory Jira (`tests/helpers/fake-jira.mjs`) that applies JSM customer visibility and rejects unexpected queries.
