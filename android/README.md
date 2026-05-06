# VCTS Android (Phase 4)

Native Android client for the Verified Collection Tracking System.

## Stack

- Kotlin 2.0 + Jetpack Compose (Material 3)
- Hilt for DI
- Retrofit + OkHttp + kotlinx-serialization for the API
- DataStore (theme + tenant cache) and EncryptedSharedPreferences (refresh token)
- Compose-native motion primitives that match the web GSAP duration tiers
- Min SDK 26, target SDK 36, applicationId `com.threefat.vcts`

## First-time setup

1. **Open the folder in Android Studio.** Use *File → Open* and pick `android/`. Studio will detect a missing Gradle wrapper jar and offer to download it - accept. (If it doesn't, run `gradle wrapper --gradle-version 8.11.1` from a terminal that has Gradle 8.11+ on the PATH.)

2. **Drop `google-services.json` at `android/app/google-services.json`.** This is the file you downloaded from Firebase in Phase 0.
   - The build is wired so the google-services plugin and Firebase deps only kick in when the file is present, so the project still compiles without it - but Phase 10 hardening expects it in place.
   - The file is in `.gitignore`; never commit it.

3. **Sync Gradle.** Studio offers a "Sync Project with Gradle Files" prompt after the wrapper download.

4. **Pick a target.**
   - *Emulator:* Studio's *Device Manager → Create device → Pixel 7, system image API 34+*. The app talks to `https://project-jcsyq.vercel.app` by default in both build types.
   - *Physical device:* enable USB debugging on Android.

5. **Run.** Select `app` → `debug` → press Run. The first launch shows a splash logo, then the Login screen.

## Phase 4 acceptance test

| Step | Expected |
| --- | --- |
| Launch the app | Splash → Login screen with animated logo |
| Toggle the OS to dark mode | Login surfaces switch to near-black; status-bar icons flip light |
| Sign in as `admin@acme.test` / `Passw0rd!` | Brief "Signing in…" spinner → Dashboard with Acme tenant chip |
| Open Settings → switch theme to *Light* | Re-render is immediate; preference survives a process kill (`adb shell am force-stop com.threefat.vcts.debug`) |
| Settings → *Sign out* | Returns to Login; the refresh token is wiped from EncryptedSharedPreferences (re-launch lands on Login, not Dashboard) |
| Sign in as `admin@globex.test` on the same device | Cross-tenant wipe runs silently; Dashboard shows Globex chip with no Acme residue |
| Sign in with wrong password | Inline red error: "Sign-in failed. Check your email and password." |
| Toggle airplane mode → try login | Inline red error: "No internet connection. Try again when you're online." |

## Pointing at a different backend

The base URL lives in `app/build.gradle.kts` under each build type's `buildConfigField("API_BASE_URL", ...)`. To point the debug build at your local web app:

- Emulator → host machine: change debug `API_BASE_URL` to `http://10.0.2.2:3000` *and* set `cleartextTrafficPermitted="true"` in `network_security_config.xml`'s `<debug-overrides>` (already set).
- Physical device on the same Wi-Fi: use the host's LAN IP, e.g. `http://192.168.1.20:3000`.

Re-sync after changing build config so Studio regenerates `BuildConfig`.

## Layout

```
app/src/main/java/com/threefat/vcts
├── MainActivity.kt              -- single Activity host, installs splash, owns theme
├── VctsApplication.kt           -- @HiltAndroidApp entry point
├── data/
│   ├── preferences/             -- AppPreferences (DataStore) + SecureStore (ESP)
│   ├── remote/                  -- Retrofit interfaces, DTOs, OkHttp interceptors
│   ├── repository/              -- AuthRepository, TenantDataWiper
│   └── session/                 -- SessionStore: in-memory access token + Flows
├── di/                          -- Hilt modules: NetworkModule, StorageModule
├── domain/model/                -- Session, ThemeMode, helpers
└── ui/
    ├── auth/                    -- LoginScreen + ViewModel
    ├── dashboard/               -- empty Dashboard (Phase 5 fills it in)
    ├── motion/                  -- AnimatedCard, StaggeredList, reduce-motion guard
    ├── nav/                     -- AppNavHost, Routes
    ├── settings/                -- Settings screen + theme toggle + sign-out
    ├── shell/                   -- AppShellViewModel for nav start destination + theme
    └── theme/                   -- VctsTheme: Color, Type, Shape, Motion
```

## What's deferred

- **Crashlytics / Analytics wiring** lands in Phase 10 once we ship a release keystore and start collecting real device data.
- **Cert pinning** uses a placeholder pin in release builds. Refresh during Phase 10 with the actual SPKI of `project-jcsyq.vercel.app`.
- **Inter / JetBrains Mono** fonts will be bundled in a Phase 8 polish pass; for now we use the system sans-serif and monospace stacks.
