import java.util.Properties

plugins {
    id("com.android.application")
}

// Release signing lives OUTSIDE git: ~/.ps-gos-signing/ (see docs/release.md). Back it up: without
// that key no future update can install over the app on the developer's phone.
val signingDir = File(System.getProperty("user.home"), ".ps-gos-signing")
val signingProps = Properties().apply {
    val f = File(signingDir, "keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
// Version: scripts/release.sh bumps version.properties (code and name) for every release.
val versionProps = Properties().apply { rootProject.file("version.properties").inputStream().use { load(it) } }
// Where the phone asks for updates (V1.57, the developer, 13 Nov 2026: "Remove the IP address part so I can't see their IP
// address when [PS] asks Cincee for updates"): the public PS repo's newest GitHub release, where the release puts
// the phone's note as gos-version.json next to the APK. Not cincee.com, and no fallback to it.
val updateBase = (project.findProperty("updateBase") as String?) ?: "https://github.com/RedbyPS/ps/releases/latest/download/"
val updateNote = (project.findProperty("updateNote") as String?) ?: "gos-version.json"

android {
    namespace = "com.cincee.ps.gos"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.cincee.ps.gos"
        minSdk = 33
        targetSdk = 36
        versionCode = versionProps.getProperty("code").toInt()
        versionName = versionProps.getProperty("name")
        buildConfigField("String", "UPDATE_BASE", "\"$updateBase\"")
        buildConfigField("String", "UPDATE_NOTE", "\"$updateNote\"")
        // The keyword of this PS version (web ps-version.json), shown next to the name.
        buildConfigField("String", "KEYWORD", "\"${versionProps.getProperty("keyword", "")}\"")
        buildConfigField("String", "SUPABASE_URL", "\"https://mxusokxekkecebwqgeru.supabase.co\"")
        buildConfigField("String", "SUPABASE_KEY", "\"sb_publishable_ahKGz1mm0oJyCeVJ_LKs6A_uMjYzW6B\"")
    }

    signingConfigs {
        if (signingProps.getProperty("storeFile") != null) {
            create("release") {
                storeFile = File(signingDir, signingProps.getProperty("storeFile"))
                storePassword = signingProps.getProperty("storePassword")
                keyAlias = signingProps.getProperty("keyAlias")
                keyPassword = signingProps.getProperty("keyPassword")
                enableV1Signing = false
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
            // SHA-256 of the release signing certificate: an update must be signed with exactly this key.
            buildConfigField("String", "CERT_SHA256", "\"${signingProps.getProperty("certSha256", "")}\"")
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            buildConfigField("String", "CERT_SHA256", "\"\"")   // debug: same key as the installed debug app only
        }
    }

    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    packaging { resources.excludes += setOf("META-INF/*.version", "DebugProbesKt.bin", "kotlin-tooling-metadata.json") }
    // No Google services, no Firebase, no Play libraries: nothing here talks to Google.
    dependenciesInfo { includeInApk = false; includeInBundle = false }
}

dependencies {
    implementation("androidx.core:core-ktx:1.19.1")
    implementation("androidx.activity:activity-ktx:1.13.0")
    implementation("androidx.fragment:fragment-ktx:1.9.1")
    implementation("androidx.webkit:webkit:1.18.0")
    implementation("androidx.work:work-runtime-ktx:2.12.0")
    implementation("androidx.biometric:biometric:1.1.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
    testImplementation("junit:junit:4.13.2")   // local JVM unit tests only (RestClock); not in the APK
    testImplementation("org.json:json:20240303")   // CmdKeyTest: org.json is a stub on the JVM
}
