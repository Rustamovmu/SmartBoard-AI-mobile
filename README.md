# SmartBord-AI frontend/mobile

Separate frontend repository selected by the user at `/Users/a1234/Developer/SmartBord-AI-frontend`. The existing Nest backend remains at `../SmartBord-AI`. See its [frontend/mobile plan](../SmartBord-AI/docs/Frontend_plan.md) and [backend plan](../SmartBord-AI/docs/Backend_plan.md).

F1 foundation source is implemented: locally bundled React/Vite/Capacitor mobile UI, native SQLite catalog and durable original-photo files. Physical-phone acceptance is pending. No website, authentication/logout integration, video, AI, gallery export, PDF, cloud storage or server lecture synchronization is implemented. The browser preview disables native capture/storage and displays no sample content.

```bash
npm ci
npm run check
npm run lint
npm test
npm run build
npm exec -- playwright install chromium
npm run test:web
```

`npm run dev` binds loopback only; the no-network CSP also blocks its HMR connection. Browser tests serve the production build on a temporary loopback port and close it afterward. `npm run native:sync` builds/copies bundled assets to the native projects. Android build: set `ANDROID_HOME` to your SDK and `JAVA_HOME` to Java 21, then `npm run android:build`. The debug package is `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`; it is ignored by Git. With a connected authorized test phone, install it using `adb install -r` and the package path. Do not uninstall an existing app to resolve an installation failure: uninstall can erase its local originals.

iPhone needs full Xcode 26+, its iOS SDK and device signing. After `npm run native:sync`, open `apps/mobile/ios/App/App.xcodeproj`, select your signing team and actual phone, and build/run. No team, certificate or provisioning profile is committed. Do not configure a remotely hosted `server.url` in Capacitor.

Lecture metadata, pending saves, hashes and native file references live only in on-device SQLite. Media lives beneath the app-owned `SmartBordVault` folder, never only in a cache. The camera-returned JPEG is preserved byte-for-byte and checked before catalog commit/open. Original photos are capped at 20 MB; one bounded on-device checksum operation runs at a time. This is not a long-video I/O implementation.

Save requests are idempotent. A valid staged/final file can finish after interruption; unknown/partial/corrupt files are not silently promoted, overwritten or deleted. Incomplete save records remain visible for recovery. Source/temp loss before any durable copy cannot be repaired from a server. App uninstall can remove app-owned files; user export is still future work.

The vault is configured for app backup exclusion; OS/device backup behavior needs actual device auditing. Android excludes app data from cloud backup and device transfer. iPhone startup reapplies/checks the vault exclusion before creating the native bridge; failure opens an error screen without capture/storage access. These flags are not proof of every OS/OEM backup behavior. Bridge logging is disabled. Do not log or copy private photos/catalogs into developer/cloud storage. There is no network API client in F1 and the production content policy blocks network connections.

On 2026-11-02, type/lint checks, 15 tests, the Chromium fallback check and Android debug build passed. Full Xcode is absent and no Android phone was connected; the user deferred device setup. The npm runtime audit reported zero advisories; four moderate development-tool findings remain in the Capacitor CLI's glob/minimatch dependency chain. See the verification record for scope and limits.

[Verification record and device protocol](docs/Verification.md) distinguishes unit/browser/build evidence from physical acceptance. F1 is **not accepted** until an actual image is saved, app killed/reopened and original read on real Android and iPhone devices with the backend stopped. Synthetic ports and Node SQLite do not establish that result.
