# Mobile foundation verification

Status on 2026-11-02: foundation source and Android debug build verified; physical Android/iPhone acceptance is pending. The user chose both platforms and deferred device setup. This is not completed F1/B3 phone-storage proof.

The source uses pinned Capacitor 8 packages, React 19, native Filesystem and community SQLite. Reference inspection covered TripLink's route/component separation and pending/error states and Nestar's layout boundary; those references have no equivalent native private vault. Their business fields, client globals and credentials were not copied.

## Actual verification

| Check | Result and boundary |
| --- | --- |
| `npm run check` | Passed TypeScript inspection without output files. |
| `npm run lint` | Passed with no warnings. |
| `npm test` | 3 suites, 15 tests passed: ten save/recovery protocol cases with synthetic ports; three native file-boundary cases with mocked SDK; two actual in-memory Node SQLite constraint/transaction cases. No physical camera/disk evidence. |
| `npm run build` | Passed Vite production build; bundled assets contain the native UI. |
| `npm run test:web` | Chromium passed at 390 × 844 and 1280 × 900: native-unavailable screen, disabled persistence controls, no fabricated data/success, no fetch/XHR/WebSocket requests or page errors, no horizontal overflow. Screenshots inspected; neither contains phone media. |
| `npm run native:sync` | Passed Android/iOS project generation and asset/plugin synchronization. This is not iOS compilation. |
| Android `assembleDebug` | Passed with API 36 SDK, Gradle 8.14.3 and temporary checksum-verified Temurin Java 21.0.13+9. Initial Java 24-only attempt failed because plugin compilation requires a Java 21 toolchain; the verified retry passed. Native dependency flatDir/unchecked-code/symbol-strip warnings remain. |
| iPhone project | Info.plist, privacy manifest and Xcode project pass `plutil -lint`. Build/signing/runtime not run: full Xcode is absent; `xcodebuild -version` fails with Command Line Tools selected. SwiftPM transitive resolution is unverified and no resolved lock is claimed. |
| Connected Android inventory | 0 connected, 0 unauthorized, 0 offline. No serial numbers collected; the task-started ADB server was stopped. No emulator or real phone app was run. |
| Dependencies | `npm audit --omit=dev --json` reports zero runtime advisories. Full audit reports 4 moderate development-tool findings: Capacitor CLI → rimraf → glob/minimatch. npm proposes incompatible CLI 4.8.2; no forced downgrade or untested major transitive override was applied. |

The final Android debug APK is 17,356,675 bytes, SHA-256 `8b87186c4baf8666c7ef504eabaae4ab49b2f83419427bb9792da6bf539b3f75`. It is an ignored local development artifact, not a signed release. Its merged manifest has backup disabled, explicit cloud/transfer rules, cleartext disabled and no unused biometric permissions. Templates include starter native tests; these were not run or counted as storage evidence.

An initial Chromium attempt failed because its executable was not installed. After the explicit Playwright download, the browser test passed. A new SDK-mock fixture initially omitted the required file-name field and failed type inspection; it was corrected before the final passing checks. These failed attempts are not counted as passes.

The backend was not started or given any lecture data. No phone photo/catalog was collected on the Mac. Synthetic test strings were used only in tests. Temporary browser preview listeners and the task-owned ADB server are stopped; single-use Gradle daemons exit after builds. Neither legacy recordings nor reference repositories were changed.

## Implemented source boundaries

`packages/local-library/src/index.ts` owns opaque local identities, the 20 MB photo limit, checksum verification, idempotent requests, one in-flight save and pending recovery. `apps/mobile/src/native-vault.ts` binds those rules to parameterized SQLite and durable app files. An initial version-1 schema is created explicitly; future migrations must preserve existing originals/catalogs.

The save protocol records a pending intent, copies the camera-returned JPEG to a stage, verifies bytes, renames to its final owned path, verifies again and atomically inserts the capture/removes pending metadata. The committed capture is read back before the Saved message. Reopen verifies the actual original's size/hash. Native reads check stat before decoding; incomplete/corrupt files are not overwritten or deleted. This preserves the JPEG returned by the camera SDK, not a claim of raw sensor-byte preservation.

No API transport, upload, analytics or authentication/logout is implemented. Production CSP has `connect-src 'none'`; native bridge logs are disabled. Android backup rules exclude root/files/databases/preferences/external app data from cloud and device transfer. iOS programmatic scene startup checks Library/SmartBordVault exclusion before constructing the bridge; the app has no main/scene storyboard startup that can bypass this gate. Actual OS backup, retention, network-packet and privacy claims still need device auditing.

## Required physical proof, on each platform

1. Install the bundled native app on a real phone. Record app commit, model and OS version without publishing serial numbers or private images.
2. Keep the backend stopped/disconnected. Create a local lecture and take an actual photo of a non-sensitive test board.
3. Wait for the real file/hash/catalog commit and the Saved message; open the checked original.
4. Force-stop/kill the app and reopen it. Open the same original with the backend still unavailable. Confirm it is the actual image, not a cached thumbnail or fixture.
5. Test camera denial/cancellation, unavailable/full storage and interrupted saves. Preserve earlier originals; do not upload a phone catalog/photo to the backend or development Mac for evidence.
6. Record actual backup flags/rules, permissions and on-device paths. No automatic developer/cloud backup may be introduced. User-controlled OS backup limitations must be reported honestly.

Authentication/logout is not integrated in this F1 target; logout/account-block file preservation cannot yet be claimed as an exercised phone case. Future integration must revoke service access without deleting the vault.

## Current limits to verify

Camera results up to 20 MB are hashed one at a time using bounded JS image buffers on the phone; native file copy/rename and SQLite own persistence. This does not implement bounded long-video recording. No video, AI filtering, gallery/Photos export, PDF, browser storage adapter, secure credential adapter or Next.js website is included.

Recovery handles valid staged/final copies and keeps incomplete records/files. Partial or altered stages are preserved and reported instead of overwritten; a fresh manual capture may be needed. If the camera activity/process is killed before returning a result, no accepted save is claimed; native camera activity restoration needs a later device exercise. File flush/power-loss behavior beyond the native plugin's completed copy/rename APIs is unverified.

Full Xcode is absent on the development Mac (Command Line Tools is selected), so iPhone build/signing and runtime checks need external setup. Android SDK/API 36 is available and the debug build passed using temporary Java 21; no device result is available. The temporary toolchain is outside the repository; no system Java selection was changed. Camera restoration before a result, physical permissions/storage failures, background/rotation interruptions, real native save/reopen, OS backup behavior and power-loss durability remain unverified.

Primary implementation references: [Capacitor setup](https://capacitorjs.com/docs/getting-started/environment-setup), [Camera](https://capacitorjs.com/docs/apis/camera), [Filesystem](https://capacitorjs.com/docs/apis/filesystem), [SQLite API](https://github.com/capacitor-community/sqlite/blob/master/docs/API.md), [Apple backup exclusion](https://developer.apple.com/documentation/foundation/optimizing-your-app-s-data-for-icloud-backup), [Android backup exclusions](https://developer.android.com/identity/data/autobackup).
