package com.cincee.ps.gos

import android.content.Context
import org.json.JSONObject

/**
 * This build's profile (V1.58, multiple developers; design: ps-handover-notes/v158-multidev-design.md section 2).
 * One small settings file per build, put into the app's assets as profile.json by Gradle: core's profiles/gsquad.json
 * for the G Squad build, a person's own profile.json in their layer (the developer's: web ps-layer/profile.json).
 * No file (every build made the V1.57 way): load() is null and every rule keeps its per account answer, as in V1.57.
 * Never a gsquad default. Pure parsing in [from], so ProfileTest checks it on the JVM.
 */
data class Profile(
    /** "gsquad" for the shared build, else the person's private release name ("red", "jan"). */
    val name: String,
    val display: String,
    val channel: Channel,
    /** Shared features made by OTHER people start on ("on" in gsquad, "off" in every person's own profile). */
    val othersShared: Boolean,
    /** Overrides of the registry default for this build, by feature id. */
    val features: Map<String, Boolean>,
    val rules: Map<String, Boolean>,
) {
    sealed class Channel {
        object GSquad : Channel()
        object Local : Channel()
        data class Url(val url: String) : Channel()
    }

    /** What the profile says about a rule, or null when it does not say. */
    fun rule(r: String): Boolean? = rules[r]

    companion object {
        /** The rules that differ per person (the same names as the web's core/profile.ts RULES). */
        val RULES = listOf("tabOverProtectedApps", "islandOverProtectedApps")
        private val NAME = Regex("^[a-z][a-z0-9]{0,31}$")
        private val ID = Regex("^[a-z][a-z0-9]*(-[a-z0-9]+)*$")
        fun isName(s: String) = NAME.matches(s)
        fun isFeatureId(s: String) = s.length <= 48 && ID.matches(s)

        /** A profile from its JSON text, or null when it is not one (a wrong file never half applies). */
        fun from(text: String?): Profile? {
            val p = try { JSONObject(text ?: return null) } catch (e: Exception) { return null }
            if (p.opt("schema") != 1) return null
            val name = p.opt("name") as? String ?: return null
            if (!isName(name)) return null
            val ch = p.optJSONObject("channel") ?: return null
            val channel = when (ch.opt("kind")) {
                "gsquad" -> Channel.GSquad
                "local" -> Channel.Local
                "url" -> {
                    val u = ch.opt("url") as? String ?: return null
                    if (!u.startsWith("https://") || u.length <= 8 || u.contains(' ')) return null
                    Channel.Url(u)
                }
                else -> return null
            }
            val others = when (p.opt("othersShared")) { "on" -> true; "off" -> false; else -> return null }
            val features = mutableMapOf<String, Boolean>()
            p.optJSONObject("features")?.let { f -> for (k in f.keys()) { val v = f.opt(k); if (isFeatureId(k) && v is Boolean) features[k] = v } }
            val rules = mutableMapOf<String, Boolean>()
            p.optJSONObject("rules")?.let { r -> for (k in RULES) { val v = r.opt(k); if (v is Boolean) rules[k] = v } }
            val d = (p.opt("display") as? String)?.trim().orEmpty()
            return Profile(name, if (d.isEmpty()) name else d.take(60), channel, others, features, rules)
        }

        /** A rule's answer: the per account answer unless the profile narrows it (both must allow it; no profile: the
         *  per account answer, as in V1.57). A wrong profile on the developer's account never widens it. */
        fun allows(rule: String, account: Boolean, profile: Profile?): Boolean {
            val v = profile?.rule(rule) ?: return account
            return v && account
        }

        @Volatile private var cached: Profile? = null
        @Volatile private var read = false
        /** This app's bundled profile (assets/profile.json), null when it has none. Read once. */
        fun load(c: Context): Profile? {
            if (!read) {
                cached = try { from(c.assets.open("profile.json").bufferedReader().use { it.readText() }) } catch (e: Exception) { null }
                read = true
            }
            return cached
        }
    }
}
