# Retail inMotion Service Hub (proof of concept)

The Portal+ live dashboard at full browser width, on its own site, without a second login.

## How sign-in works

1. The customer signs in to the JSM portal as usual.
2. **Service Hub ↗** in Portal+ asks Portal+ for a pass. The pass works once, expires after 60 seconds, and is signed with `HUB_SECRET`. It names the customer's verified account and project.
3. The hub checks the pass and sets an 8-hour `HttpOnly` session cookie.
4. The hub fetches data from the Portal+ web trigger with signed requests. Portal+ re-runs its normal checks on every call: the visibility list, the customer's organisations and experience routing. Removing someone from Portal+ therefore cuts off their hub access immediately.

The hub holds no Jira credentials.

## Run locally

```bash
npm run hub          # builds hub/dist/hub.js and starts http://localhost:4820
```

`hub/.env` (gitignored) must contain `HUB_SECRET=<the same value as the HUB_SECRET repository secret>`.

## Configure Portal+ (development environment only)

- Repository secret `HUB_SECRET`: 64 hex characters.
- Repository variable `HUB_URL`: `http://localhost:4820` for the proof of concept.

Run **Remote Forge QA** with deploy enabled. The workflow sets both as Forge variables on the development environment. Where they are not set (production), Portal+ hides the button and the web trigger answers 404.

## Before production

- HTTPS hosting, with `HUB_SECURE_COOKIE=true`.
- Store used pass nonces somewhere shared if the hub runs on more than one instance.
- Rotate `HUB_SECRET`.
- Add a security review of the web trigger.
