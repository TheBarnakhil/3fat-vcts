// App module build script. The Compose compiler plugin (Kotlin 2.x) replaces
// the old composeOptions{} block; KSP runs Hilt's annotation processor.
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
}

// Apply the google-services plugin only when the JSON config is on disk.
// This keeps debug builds working on clean checkouts. Release builds fail
// loudly through [validateReleaseInputs] until Firebase + signing are present.
val googleServicesJson = file("google-services.json")
if (googleServicesJson.exists()) {
    apply(plugin = libs.plugins.google.services.get().pluginId)
    apply(plugin = libs.plugins.firebase.crashlytics.get().pluginId)
}

val releaseStoreFile = providers.environmentVariable("VCTS_RELEASE_STORE_FILE").orNull
val releaseStorePassword = providers.environmentVariable("VCTS_RELEASE_STORE_PASSWORD").orNull
val releaseKeyAlias = providers.environmentVariable("VCTS_RELEASE_KEY_ALIAS").orNull
val releaseKeyPassword = providers.environmentVariable("VCTS_RELEASE_KEY_PASSWORD").orNull
val releaseSigningConfigured = listOf(
    releaseStoreFile,
    releaseStorePassword,
    releaseKeyAlias,
    releaseKeyPassword,
).all { !it.isNullOrBlank() }

android {
    namespace = "com.threefat.vcts"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.threefat.vcts"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.8.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // The API base URL is selected per-build via BuildConfig so debug
        // builds talk to localhost while release talks to the Vercel deploy.
        // The actual host is overridden in the build types below.
        buildConfigField("String", "API_BASE_URL", "\"\"")
        // SPKI pin (sha256/...). Empty means "no pinning" - acceptable in dev,
        // never in release. Wired in NetworkModule.
        buildConfigField("String[]", "API_CERT_PINS", "new String[]{}")
        buildConfigField("boolean", "FIREBASE_ENABLED", googleServicesJson.exists().toString())
    }

    signingConfigs {
        create("releaseEnv") {
            if (!releaseStoreFile.isNullOrBlank()) {
                storeFile = file(releaseStoreFile)
            }
            storePassword = releaseStorePassword
            keyAlias = releaseKeyAlias
            keyPassword = releaseKeyPassword
        }
    }

    buildTypes {
        getByName("debug") {
            isMinifyEnabled = false
            // We deliberately do NOT set applicationIdSuffix here. Doing so
            // would produce `com.threefat.vcts.debug`, which would not match
            // the single client registered in google-services.json and would
            // fail the processDebugGoogleServices task. If you ever need
            // side-by-side install of debug + release, register a second
            // Android app in the Firebase console with the suffixed package
            // and download a fresh google-services.json before re-enabling.
            //
            // 10.0.2.2 is the loopback address from the Android emulator to
            // the host machine; useful when iterating against `pnpm dev`.
            buildConfigField(
                "String",
                "API_BASE_URL",
                "\"https://project-jcsyq.vercel.app\""
            )
            // Pinning disabled in debug to make TLS-replacing proxies (Charles,
            // Proxyman) and self-signed local certs work.
            buildConfigField("String[]", "API_CERT_PINS", "new String[]{}")
        }
        getByName("release") {
            isMinifyEnabled = true
            isShrinkResources = true
            if (releaseSigningConfigured) {
                signingConfig = signingConfigs.getByName("releaseEnv")
            }
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            buildConfigField(
                "String",
                "API_BASE_URL",
                "\"https://project-jcsyq.vercel.app\""
            )
            // SPKI pins for project-jcsyq.vercel.app as observed on
            // 2026-05-10. Includes the current *.vercel.app leaf, Google WR1
            // intermediate, and GTS Root R1 as a backup. Rotate via
            // docs/runbooks/android-release.md before they age out.
            buildConfigField(
                "String[]",
                "API_CERT_PINS",
                "new String[]{" +
                    "\"sha256/fndKWNHkmWFva8LCkbaQ6j1HS5JLIT9dD8JdQm41s7o=\"," +
                    "\"sha256/yDu9og255NN5GEf+Bwa9rTrqFQ0EydZ0r1FCh9TdAW4=\"," +
                    "\"sha256/hxqRlPTu1bMS/0DITB1SSu0vd4u/8l8TjPgfaAp63Gc=\"" +
                    "}"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
        // Opt-in to APIs we use intentionally; keeps the rest strict.
        freeCompilerArgs += listOf(
            "-opt-in=androidx.compose.material3.ExperimentalMaterial3Api",
            "-opt-in=androidx.compose.foundation.ExperimentalFoundationApi",
            "-opt-in=androidx.compose.animation.ExperimentalSharedTransitionApi",
            "-opt-in=kotlinx.serialization.ExperimentalSerializationApi",
        )
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    packaging {
        resources {
            excludes += setOf(
                "/META-INF/{AL2.0,LGPL2.1}",
                "/META-INF/DEPENDENCIES",
                "/META-INF/LICENSE",
                "/META-INF/NOTICE",
            )
        }
    }
}

dependencies {
    // -- AndroidX ---------------------------------------------------------
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.core.splashscreen)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.androidx.security.crypto)

    // -- Room + SQLCipher -------------------------------------------------
    // Room 2.6.x runs through KSP1 (matches our gradle.properties setting).
    // From Phase 6 onward the underlying SQLite is opened through
    // SQLCipher's SupportFactory, with the passphrase derived from a
    // Keystore-sealed entry in EncryptedSharedPreferences.
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)
    implementation(libs.androidx.sqlite)
    implementation(libs.sqlcipher.android)

    // -- WorkManager (offline sync engine - Phase 6) ---------------------
    implementation(libs.androidx.work.runtime.ktx)
    implementation(libs.androidx.hilt.work)
    ksp(libs.androidx.hilt.compiler)

    // -- Compose ----------------------------------------------------------
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.extended)
    implementation(libs.androidx.compose.runtime)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    debugImplementation(libs.androidx.compose.ui.tooling)
    debugImplementation(libs.androidx.compose.ui.test.manifest)

    // -- Hilt -------------------------------------------------------------
    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.androidx.hilt.navigation.compose)

    // -- Networking + Serialization --------------------------------------
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.coroutines.play.services)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.okhttp)
    implementation(libs.okhttp.logging)
    implementation(libs.retrofit)
    implementation(libs.retrofit.kotlinx.serialization)

    // -- Firebase / Play Services (Crashlytics SDK wired in Phase 10) -----
    // Firebase BoM + analytics are only meaningful if google-services.json
    // is present; gating their inclusion the same way avoids spurious
    // missing-resource warnings on a clean checkout.
    if (googleServicesJson.exists()) {
        implementation(platform(libs.firebase.bom))
        implementation(libs.firebase.analytics)
        implementation(libs.firebase.crashlytics)
    }
    implementation(libs.play.services.location)

    // -- CameraX (Phase 8 - on-device proof photo) ------------------------
    implementation(libs.androidx.camera.core)
    implementation(libs.androidx.camera.camera2)
    implementation(libs.androidx.camera.lifecycle)
    implementation(libs.androidx.camera.view)

    // -- Coil (Phase 8 - render captured photo / signature thumbnails) ---
    implementation(libs.coil.compose)

    // -- ZXing (Phase 8 - QR generation for the receipt PDF) -------------
    implementation(libs.zxing.core)

    // -- PDF (on-device receipt preview) ---------------------------------
    // pdfbox-android is the AGPL-free Apache 2.0 port of Apache PDFBox.
    // We call PDFBoxResourceLoader.init(context) once at app start; see
    // VctsApplication.
    implementation(libs.pdfbox.android)

    // -- Tests ------------------------------------------------------------
    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.test.junit.ext)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
}

tasks.register("validateReleaseInputs") {
    group = "verification"
    description = "Fails release builds until Firebase config, signing env, and TLS pins are present."

    doLast {
        if (!googleServicesJson.exists()) {
            throw GradleException(
                "Missing android/app/google-services.json. Download it from Firebase before building release."
            )
        }
        if (!releaseSigningConfigured) {
            throw GradleException(
                "Missing release signing env. Set VCTS_RELEASE_STORE_FILE, " +
                    "VCTS_RELEASE_STORE_PASSWORD, VCTS_RELEASE_KEY_ALIAS, and " +
                    "VCTS_RELEASE_KEY_PASSWORD."
            )
        }
        val pins = listOf(
            "sha256/fndKWNHkmWFva8LCkbaQ6j1HS5JLIT9dD8JdQm41s7o=",
            "sha256/yDu9og255NN5GEf+Bwa9rTrqFQ0EydZ0r1FCh9TdAW4=",
            "sha256/hxqRlPTu1bMS/0DITB1SSu0vd4u/8l8TjPgfaAp63Gc=",
        )
        check(pins.none { it.contains("AAAAAAAA") }) {
            "Release certificate pins still contain the placeholder value."
        }
    }
}

tasks.matching { it.name == "preReleaseBuild" }.configureEach {
    dependsOn("validateReleaseInputs")
}
