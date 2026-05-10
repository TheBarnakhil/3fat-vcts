# Keep generated DI bindings + runtime-reflection hooks. R8 is good at modern
# Compose, so these rules stay focused on libraries that use generated code,
# metadata, JNI, or service discovery.

# kotlinx-serialization: keep @Serializable classes' generated companions
-keepattributes Signature,*Annotation*,InnerClasses,EnclosingMethod
-dontnote kotlinx.serialization.AnnotationsKt
-keepclasseswithmembers class * {
    kotlinx.serialization.KSerializer serializer(...);
}
-keepclassmembers class **$$serializer { *; }
-keep class kotlinx.serialization.** { *; }
-keep class com.threefat.vcts.data.remote.dto.** { *; }
-keep class com.threefat.vcts.domain.model.** { *; }

# OkHttp + Retrofit reflection-light usage; these rules are conservative.
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn retrofit2.**
-keep class retrofit2.** { *; }
-keepattributes RuntimeVisibleAnnotations,RuntimeVisibleParameterAnnotations
-keepclasseswithmembers interface * {
    @retrofit2.http.* <methods>;
}

# OkHttp ships service-provider files for TLS/platform integrations. Keep
# Kotlin metadata and companion constants that its platform lookup can inspect.
-keep class okhttp3.** { *; }
-keep class okio.** { *; }

# Hilt: the generator emits classes referenced via reflection at startup.
-keep class dagger.hilt.** { *; }
-keep class * extends dagger.hilt.android.lifecycle.HiltViewModel

# Room + WorkManager + Hilt workers.
-keep class androidx.room.RoomDatabase { *; }
-keep class com.threefat.vcts.data.local.** { *; }
-keep class * extends androidx.work.ListenableWorker
-keep class * extends androidx.hilt.work.HiltWorker

# SQLCipher loads JNI by class name and native symbol. Don't shrink away the
# support classes that Room references indirectly through SupportFactory.
-keep class net.zetetic.** { *; }
-keep class net.sqlcipher.** { *; }
-dontwarn net.zetetic.**
-dontwarn net.sqlcipher.**

# PDFBox-Android reads bundled resources and uses some optional desktop AWT
# classes that are absent on Android.
-keep class com.tom_roush.** { *; }
-dontwarn com.tom_roush.**
-dontwarn java.awt.**
-dontwarn javax.imageio.**

# Firebase Crashlytics / Analytics are only included when google-services.json
# is present. These keeps make the release build deterministic when enabled.
-keep class com.google.firebase.crashlytics.** { *; }
-keep class com.google.firebase.analytics.** { *; }
-dontwarn com.google.firebase.**

# CameraX / Coil occasionally reference optional APIs across API levels.
-dontwarn androidx.camera.**
-dontwarn coil.**
