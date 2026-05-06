# Keep generated DI bindings + Compose runtime hooks. ProGuard is otherwise
# pretty good at not breaking modern Compose, so we add only what's needed.

# kotlinx-serialization: keep @Serializable classes' generated companions
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keepclasseswithmembers class * {
    kotlinx.serialization.KSerializer serializer(...);
}

# OkHttp + Retrofit reflection-light usage; these rules are conservative.
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn retrofit2.**
-keep class retrofit2.** { *; }

# Hilt: the generator emits classes referenced via reflection at startup.
-keep class dagger.hilt.** { *; }
-keep class * extends dagger.hilt.android.lifecycle.HiltViewModel
