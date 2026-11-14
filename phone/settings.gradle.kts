pluginManagement {
    repositories { google(); mavenCentral(); gradlePluginPortal() }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google(); mavenCentral()
        // Gym scan (V1.59): Tesseract4Android is not fetched from anywhere; its AAR is in app/libs (see app/build.gradle.kts).
    }
}
rootProject.name = "ps-gos"
include(":app")
