# PS GOS: the web page talks to the shell through WebMessageListener (no @JavascriptInterface), so
# nothing needs keeping beyond the defaults and the components named in the manifest.
-keepattributes SourceFile,LineNumberTable

# Gym scan (V1.59): Tesseract and Leptonica are called from their native code by name (JNI), so their classes stay as they are.
-keep class com.googlecode.tesseract.android.** { *; }
-keep class com.googlecode.leptonica.android.** { *; }
