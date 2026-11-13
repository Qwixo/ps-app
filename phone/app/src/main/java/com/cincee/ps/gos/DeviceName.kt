package com.cincee.ps.gos

/**
 * The phone's maker and model for the page (V1.56 phone layout editor). The Mac's Edit mode lists the phones that opened
 * PS ("Pixel 8, GrapheneOS"), so the page sends this in its small encrypted phone record (src/core/phonedevices.ts).
 * Only Build.MANUFACTURER and Build.MODEL, which every app can read: no serial, no IMEI, nothing that identifies this one
 * handset. Sent as "maker|model"; the page makes the name (androidName).
 */
object DeviceName {
    private fun clean(v: String?): String =
        (v ?: "").filter { it >= ' ' && it != '|' && it.code != 0x7F }.replace(Regex("\\s+"), " ").trim().take(30)

    fun of(maker: String?, model: String?): String {
        val mk = clean(maker)
        val md = clean(model)
        return if (mk.isEmpty() && md.isEmpty()) "" else "$mk|$md"
    }
}
