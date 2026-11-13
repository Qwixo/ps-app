package com.cincee.ps.gos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

/** V1.57: the phone asks the public PS repo's GitHub release for updates, never cincee.com. */
class UpdateWhereTest {
    private val gh = "https://github.com/RedbyPS/ps/releases/latest/download/"

    @Test fun theReleaseBuildAsksGitHub() {
        assertEquals(gh, UpdateWhere.base())
        assertEquals(gh + "gos-version.json", UpdateWhere.note())
        assertFalse(BuildConfig.UPDATE_BASE.contains("cincee"))
    }

    @Test fun theApkIsBesideTheNote() {
        assertEquals(gh + "ps-gos-1.57.apk", UpdateWhere.apk("ps-gos-1.57.apk"))
        assertEquals(gh + "ps-gos-1.57-b62.apk", UpdateWhere.apk("ps-gos-1.57-b62.apk"))
    }

    @Test fun oddNamesAreRefused() {
        assertNull(UpdateWhere.apk("../ps-gos.apk"))
        assertNull(UpdateWhere.apk("https://cincee.com/client/gos/ps-gos-1.57.apk"))
        assertNull(UpdateWhere.apk("sub/ps-gos.apk"))
        assertNull(UpdateWhere.apk("ps-gos.zip"))
        assertNull(UpdateWhere.apk(".apk"))
        assertNull(UpdateWhere.apk(""))
    }

    @Test fun aTestServerKeepsItsOwnPlace() {
        assertEquals("https://10.0.2.2:8443/gos/gos-version.json", UpdateWhere.note("https://10.0.2.2:8443/gos", "gos-version.json"))
    }
}
