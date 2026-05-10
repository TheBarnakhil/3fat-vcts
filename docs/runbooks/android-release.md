# Android Release Runbook

Phase 10 Track D release checklist for the VCTS field app.

## Inputs

- Firebase Android app registered for package `com.threefat.vcts`.
- `android/app/google-services.json` downloaded from Firebase Console. This file is ignored by git and must never be committed.
- Release keystore stored outside the repo.
- Google Maps Android key restrictions updated after the release certificate SHA-1 is known.

## Release Signing

The Gradle release signing config reads these environment variables:

```bash
export VCTS_RELEASE_STORE_FILE="/absolute/path/to/vcts-release.jks"
export VCTS_RELEASE_STORE_PASSWORD="..."
export VCTS_RELEASE_KEY_ALIAS="vcts"
export VCTS_RELEASE_KEY_PASSWORD="..."
```

If any value is missing, `validateReleaseInputs` fails `assembleRelease`. Android Studio can still use its manual signing wizard for ad-hoc local testing, but CI/repeatable builds should use the variables above.

To print the SHA-1 Google needs for API key restrictions:

```bash
keytool -list -v \
  -keystore "$VCTS_RELEASE_STORE_FILE" \
  -alias "$VCTS_RELEASE_KEY_ALIAS"
```

Add the SHA-1 + package name `com.threefat.vcts` to the restricted `ANDROID_API_KEY` in Google Cloud Console before distributing the APK.

## Firebase

Drop the Firebase config here:

```text
android/app/google-services.json
```

The Gradle build applies `com.google.gms.google-services` and `com.google.firebase.crashlytics` only when this file exists. This keeps clean checkouts buildable, while release machines get Analytics + Crashlytics automatically.

Smoke test after installing a release build:

1. Open Firebase Console -> Realtime Analytics; launch the app and confirm a new active user appears within a few minutes.
2. Open Crashlytics -> App quality. The first session can take several minutes to appear.
3. Do not force a production crash unless you are using an internal test track or a debug-only test build.

## TLS Pin Rotation

Release builds pin the API host in `android/app/build.gradle.kts` via `BuildConfig.API_CERT_PINS`.

Current host:

```text
project-jcsyq.vercel.app
```

Current pins captured on 2026-05-10:

```text
CN=*.vercel.app
sha256/fndKWNHkmWFva8LCkbaQ6j1HS5JLIT9dD8JdQm41s7o=

C=US, O=Google Trust Services, CN=WR1
sha256/yDu9og255NN5GEf+Bwa9rTrqFQ0EydZ0r1FCh9TdAW4=

C=US, O=Google Trust Services LLC, CN=GTS Root R1
sha256/hxqRlPTu1bMS/0DITB1SSu0vd4u/8l8TjPgfaAp63Gc=
```

Recompute before each release:

```bash
printf '' \
  | openssl s_client -servername project-jcsyq.vercel.app -connect project-jcsyq.vercel.app:443 -showcerts 2>/dev/null \
  | awk '/BEGIN CERTIFICATE/{i++} {print > ("/tmp/vcts-cert-" i ".pem")}'

for f in /tmp/vcts-cert-*.pem; do
  if openssl x509 -in "$f" -noout >/dev/null 2>&1; then
    openssl x509 -in "$f" -noout -subject
    openssl x509 -in "$f" -pubkey -noout \
      | openssl pkey -pubin -outform DER \
      | openssl dgst -sha256 -binary \
      | openssl base64 \
      | sed 's#^#sha256/#'
  fi
done
rm -f /tmp/vcts-cert-*.pem
```

Pin at least the current leaf and one backup/intermediate pin. Keep debug builds unpinned so Charles/Proxyman and local development still work.

## Build Commands

This repo intentionally does not commit a Gradle wrapper yet. Android Studio can generate/download it when opening `android/`, or run from a machine with a compatible Gradle installation.

Recommended release build from `android/`:

```bash
./gradlew :app:clean :app:assembleRelease
```

If no wrapper is present:

```bash
gradle :app:clean :app:assembleRelease
```

Expected artifacts:

```text
android/app/build/outputs/apk/release/app-release.apk
```

## Internal Testing

1. Upload the signed APK/AAB to Play Console -> Internal testing.
2. Add tester emails.
3. Install from the Play testing link, not via `adb install`, for final checks.
4. Confirm login, offline queue drain, active-duty tracking notification, photo/signature capture, PDF receipt preview/share, and background relaunch after force-stop/reboot.

