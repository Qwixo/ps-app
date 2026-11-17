package com.cincee.ps.gos

import android.content.Context
import java.io.File
import java.io.InputStream

/*
 * The Tesseract models, copied out of the APK for the receipt scan and the gym scan (Tesseract reads files, not assets).
 * The APK stores assets/tessdata compressed, and a compressed asset cannot be opened with openFd (it throws), so the size
 * is never read from the APK: a stamp with the app's install time says the copies are from this build, and they are
 * copied again after an update or when one is missing or empty. Each scan keeps its own stamp (tag), so one scan's copy
 * never makes the other skip a model it needs. The copy is the pure part (OcrModelsTest on the JVM).
 */
object OcrModels {
    /** Copy the models for one scan and give back the folder Tesseract starts from, or null when a copy failed. */
    fun root(c: Context, langs: String, tag: String): File? {
        val root = File(c.noBackupFilesDir, "ocr")
        val build = runCatching { c.packageManager.getPackageInfo(c.packageName, 0).lastUpdateTime.toString() }.getOrDefault("")
        return if (copyOut(File(root, "tessdata"), langs, tag, build) { c.assets.open("tessdata/$it") }) root else null
    }

    /** Copy each "a+b" model that [needsCopy] says is stale into [dir], through a part file and a rename so a half copy
     *  is never read, then stamp [dir] for [tag] with [build]. Synchronized: the two scans run on their own threads and
     *  share the folder. False when a model could not be put in place. */
    @Synchronized
    fun copyOut(dir: File, langs: String, tag: String, build: String, open: (String) -> InputStream): Boolean {
        dir.mkdirs()
        val stamp = File(dir, ".$tag-models")
        val had = runCatching { stamp.readText() }.getOrNull()
        for (lang in langs.split("+")) {
            val name = "$lang.traineddata"
            val f = File(dir, name)
            if (needsCopy(had, build, f.length())) {
                val tmp = File(dir, "$name.$tag.part")
                try {
                    open(name).use { i -> tmp.outputStream().use { o -> i.copyTo(o) } }
                } catch (e: Throwable) { tmp.delete(); throw e }
                if (!tmp.renameTo(f)) { tmp.delete(); return false }
            }
        }
        if (had != build) runCatching { stamp.writeText(build) }
        return true
    }

    /** Copy a model out of the APK again: no copy yet (or an empty one), or the copies are not stamped with this build. */
    fun needsCopy(stamp: String?, build: String, length: Long): Boolean = length <= 0L || build.isEmpty() || stamp != build
}
