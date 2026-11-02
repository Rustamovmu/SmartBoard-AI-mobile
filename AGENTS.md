# SmartBord-AI frontend/mobile

The user selected `/Users/a1234/Developer/SmartBord-AI-frontend` as this separate project. The backend remains at `../SmartBord-AI` and is not a media store. Read README, docs/Verification.md and the backend's `docs/Frontend_plan.md` and `docs/Backend_plan.md` before changing behavior. Plans are targets; dated verification establishes implemented scope.

Use npm, pinned dependencies and package-lock.json. This repository is ESM; do not change the backend's CommonJS/nodenext configuration. `apps/mobile` is the React/Vite/Capacitor target; `packages/local-library` contains framework-independent models, interfaces and save/recovery rules. The future Next.js website is not implemented.

Private lecture titles, photos, notes, catalog, recovery records and checksums stay on the phone. Use native SQLite and durable app files, never a cache-only original or backend sync. Preserve originals. Keep app backup exclusions and no-transmission CSP. Do not add telemetry, body logs, uploads, cloud backup, CDN media, a developer photo copy, account-driven file deletion or a fabricated success/AI result.

No native authentication/logout integration, video recorder, AI, gallery export, PDF or website exists in F1. Do not present browser preview as phone persistence. Do not erase local files on logout or account blocking when those integrations are implemented. Tokens belong in Keychain/Keystore, not this catalog. Respect OS permission denial/cancel; show Saved only after file verification and SQLite commit.

Review pending saves before changing their state machine. One capture/save runs at a time. Staged/final files and pending catalog records survive failure; retries use the same request ID, verify bytes and do not duplicate captures. Never silently delete files to free space.

Keep servers stopped outside necessary temporary verification. Run `npm run check`, `npm run lint`, `npm test`, `npm run build` and appropriate browser/native checks. Fake ports/fixtures are unit evidence only, not proof of native disk, camera, backup behavior or physical phones. Record actual Android/iPhone build/device limitations, restart/offline results, disk/permission failures and interrupted saves honestly.

Reference projects `../tripLInk-next` and `../nestar-next` are read-only; adapt component/layout boundaries, not business fields, ports, secrets, client globals or their commit/approval policies. They have no equivalent native private vault. Do not copy legacy recordings or user data.

Inspect status/branch/diff before explicit staging; preserve unrelated changes. Every completed cohesive change requires a focused local commit with tests/contracts/docs and its hash in the report. Do not push, amend/rebase, delete user data or claim F1 acceptance without a real phone save/restart/reopen with the backend stopped. Until actual physical tests pass, call this a foundation implementation, not completed phone-storage proof.
