# ════════════════════════════════════════════════════════════════════════════════
#  ProGuard / R8 — GitPush Android
#  Obfuscation maximale compatible React Native / Expo / Hermes
# ════════════════════════════════════════════════════════════════════════════════

# ── Options générales ──────────────────────────────────────────────────────────
-optimizationpasses 5
-allowaccessmodification
-mergeinterfacesaggressively
-overloadaggressively
-repackageclasses 'x'
-verbose

# ── React Native Core ──────────────────────────────────────────────────────────
-keep class com.facebook.react.** { *; }
-keep class com.facebook.react.bridge.** { *; }
-keep class com.facebook.react.uimanager.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }
-keep class com.facebook.react.fabric.** { *; }
-keep class com.facebook.react.devsupport.** { *; }
-keep class com.facebook.react.modules.** { *; }

# ── Hermes (moteur JS) ────────────────────────────────────────────────────────
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.hermes.reactexecutor.** { *; }
-keep class com.facebook.hermes.unicode.** { *; }
-dontwarn com.facebook.hermes.**

# ── JSI (JavaScript Interface) ────────────────────────────────────────────────
-keep class com.facebook.jni.** { *; }
-keep class com.facebook.soloader.** { *; }

# ── Expo Modules ──────────────────────────────────────────────────────────────
-keep class expo.modules.** { *; }
-keep class expo.modules.core.** { *; }
-keep class expo.modules.kotlin.** { *; }
-keep class expo.modules.interfaces.** { *; }
-keep class expo.modules.filesystem.** { *; }
-keep class expo.modules.documentpicker.** { *; }
-keep class expo.modules.font.** { *; }
-keep class expo.modules.router.** { *; }
-keep class expo.modules.splashscreen.** { *; }
-keep class expo.modules.haptics.** { *; }
-keep class expo.modules.linking.** { *; }
-keep class expo.modules.constants.** { *; }
-keep class expo.modules.statusbar.** { *; }
-keep class expo.modules.systemui.** { *; }
-keep class expo.modules.webbrowser.** { *; }
-keep class expo.modules.image.** { *; }
-keep class expo.modules.blur.** { *; }
-keep class expo.modules.lineargradient.** { *; }

# ── Reanimated ────────────────────────────────────────────────────────────────
-keep class com.swmansion.reanimated.** { *; }
-keep class com.swmansion.gesturehandler.** { *; }
-keep class com.swmansion.rnscreens.** { *; }
-keep class com.swmansion.** { *; }
-dontwarn com.swmansion.**

# ── Async Storage ─────────────────────────────────────────────────────────────
-keep class com.reactnativecommunity.asyncstorage.** { *; }

# ── React Native SVG ──────────────────────────────────────────────────────────
-keep class com.horcrux.svg.** { *; }

# ── Kotlin ────────────────────────────────────────────────────────────────────
-keep class kotlin.** { *; }
-keep class kotlin.Metadata { *; }
-keep class kotlinx.** { *; }
-dontwarn kotlin.**
-dontwarn kotlinx.**

# ── Coroutines Kotlin ─────────────────────────────────────────────────────────
-keepnames class kotlinx.coroutines.internal.MainDispatcherFactory {}
-keepnames class kotlinx.coroutines.CoroutineExceptionHandler {}
-keepclassmembernames class kotlinx.** {
    volatile <fields>;
}

# ── JNI / Natif ───────────────────────────────────────────────────────────────
-keepclasseswithmembernames,includedescriptorclasses class * {
    native <methods>;
}

# ── Réflexion / Sérialisation ─────────────────────────────────────────────────
-keepattributes Signature
-keepattributes *Annotation*
-keepattributes SourceFile,LineNumberTable
-keepattributes RuntimeVisibleAnnotations
-keepattributes InnerClasses
-keepattributes EnclosingMethod

# ── Enums ─────────────────────────────────────────────────────────────────────
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# ── Parcelable / Serializable ─────────────────────────────────────────────────
-keepclassmembers class * implements android.os.Parcelable {
    public static final android.os.Parcelable$Creator CREATOR;
}
-keepclassmembers class * implements java.io.Serializable {
    static final long serialVersionUID;
    private static final java.io.ObjectStreamField[] serialPersistentFields;
    private void writeObject(java.io.ObjectOutputStream);
    private void readObject(java.io.ObjectInputStream);
    java.lang.Object writeReplace();
    java.lang.Object readResolve();
}

# ── Suppression du code de debug ──────────────────────────────────────────────
-assumenosideeffects class android.util.Log {
    public static boolean isLoggable(java.lang.String, int);
    public static int d(...);
    public static int v(...);
    public static int i(...);
}

# ── Suppress warnings non bloquants ───────────────────────────────────────────
-dontwarn com.facebook.react.**
-dontwarn expo.modules.**
-dontwarn org.webkit.**
-dontwarn okio.**
-dontwarn okhttp3.**
-dontwarn javax.annotation.**
-dontwarn sun.misc.**
-dontwarn java.lang.invoke.**
-dontwarn com.google.android.gms.**
