package com.vibethroughcode.ftree.ui

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.core.content.FileProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import com.vibethroughcode.ftree.FTreeApplication
import com.vibethroughcode.ftree.MainActivity
import com.vibethroughcode.ftree.data.Person
import com.vibethroughcode.ftree.data.RelativeKind
import com.vibethroughcode.ftree.transfer.openedTree
import com.vibethroughcode.ftree.ui.transfer.ImportConfirmTag
import java.io.File
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * A family tree arriving from somewhere else.
 *
 * The share was only half a feature while the file it produced could not be opened: a relative
 * receives a `.ftree` in a chat app and there is nothing on their phone that will take it. These
 * are the two gestures they will actually make — tapping the file, and choosing this app from a
 * share sheet — and in both the file is shown as a proposal, never applied on arrival.
 */
@RunWith(AndroidJUnit4::class)
class OpenTreeFileTest {

    @get:Rule
    val rule = createEmptyComposeRule()

    private val context
        get() = InstrumentationRegistry.getInstrumentation().targetContext

    private val app: FTreeApplication
        get() = context.applicationContext as FTreeApplication

    private lateinit var sandeep: Person

    @Before
    fun seedAFamily() {
        app.container.database.clearAllTables()
        val repository = app.container.familyRepository
        sandeep = Person(name = "Sandeep Kumar", birthDate = "1958")
        val pragya = Person(name = "Pragya Kumari", birthDate = "1962")
        val ankit = Person(name = "Ankit Kumar", birthDate = "1990")
        runBlocking {
            listOf(sandeep, pragya, ankit).forEach { repository.addPerson(it) }
            repository.addRelative(sandeep.id, pragya.id, RelativeKind.SPOUSE)
            repository.addRelative(sandeep.id, ankit.id, RelativeKind.CHILD)
        }
    }

    @After
    fun closeWhateverIsOpen() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            listOf(Stage.RESUMED, Stage.STARTED, Stage.PAUSED).forEach { stage ->
                ActivityLifecycleMonitorRegistry.getInstance()
                    .getActivitiesInStage(stage)
                    .forEach { it.finish() }
            }
        }
    }

    /** The app's own share, which is where a file people actually receive comes from. */
    private fun sharedBranch(): Uri = runBlocking {
        app.container.branchShare.prepare(sandeep.id)!!.uri
    }

    /** Something with the right name and nothing else right about it. */
    private fun notATree(): Uri {
        val directory = File(context.cacheDir, "shared").apply { mkdirs() }
        val file = File(directory, "holiday-photos.ftree")
        file.writeText("this is not a family tree")
        return FileProvider.getUriForFile(context, "${context.packageName}.shares", file)
    }

    private fun open(intent: Intent) {
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    private fun awaitReview() = rule.waitUntil(15_000) {
        rule.onAllNodesWithTag(ImportConfirmTag).fetchSemanticsNodes().isNotEmpty()
    }

    @Test
    fun aTreeTappedInAFileManagerIsOfferedForReview() {
        open(Intent(context, MainActivity::class.java).setAction(Intent.ACTION_VIEW).setData(sharedBranch()))

        awaitReview()
        // Sandeep, his wife and his son: the branch that was shared, counted back on arrival.
        rule.waitUntil(5_000) {
            rule.onAllNodesWithText("3 people", substring = true).fetchSemanticsNodes().isNotEmpty()
        }
    }

    @Test
    fun aTreeSentFromAChatAppIsOfferedForReview() {
        open(
            Intent(context, MainActivity::class.java)
                .setAction(Intent.ACTION_SEND)
                .setType("application/octet-stream")
                .putExtra(Intent.EXTRA_STREAM, sharedBranch())
        )

        awaitReview()
    }

    /**
     * The price of being offered for files of no particular type is being handed some of them.
     *
     * It is paid here: read, refused in a sentence, and the tree left exactly as it was — rather
     * than the app declining to appear in the list when somebody needs it.
     */
    @Test
    fun somethingThatIsNotATreeIsRefusedRatherThanImported() {
        open(Intent(context, MainActivity::class.java).setAction(Intent.ACTION_VIEW).setData(notATree()))

        rule.waitUntil(15_000) {
            rule.onAllNodesWithText("That file isn't a family tree export.").fetchSemanticsNodes().isNotEmpty()
        }
        rule.onAllNodesWithTag(ImportConfirmTag).fetchSemanticsNodes().let {
            assertEquals("nothing was proposed", 0, it.size)
        }
    }

    /** Whether the app is in the list at all, which is decided by the manifest and nothing else. */
    private fun offeredFor(intent: Intent): Boolean = context.packageManager
        .queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)
        .any { it.activityInfo.name == MainActivity::class.java.name }

    /**
     * The part the app cannot test by starting itself.
     *
     * Every other test here launches MainActivity by name, which skips the manifest entirely. This
     * is the question somebody actually has — "does f-tree come up when I tap the file my cousin
     * sent me" — and it is answered by asking the system, with the intents chat apps really send.
     */
    @Test
    fun theAppComesUpForAFileSomebodyWasSent() {
        // What a chat app hands over: its own provider, and a type it invented for an extension
        // nothing has heard of.
        val tapped = Intent(Intent.ACTION_VIEW).setDataAndType(
            Uri.parse("content://com.whatsapp.provider.media/item/42"),
            "application/octet-stream",
        )
        assertTrue("not offered when a received file is tapped", offeredFor(tapped))

        val shared = Intent(Intent.ACTION_SEND)
            .setType("application/octet-stream")
            .putExtra(Intent.EXTRA_STREAM, Uri.parse("content://com.whatsapp.provider.media/item/42"))
        assertTrue("not offered on a share sheet", offeredFor(shared))

        /*
         * And not claimed, on purpose: a `file:` path with the right name on it. The app cannot
         * read one without a storage permission it has no other reason to hold, so being in the
         * list for it would mean appearing and then failing.
         */
        val path = Intent(Intent.ACTION_VIEW).setDataAndType(
            Uri.parse("file:///storage/emulated/0/Download/Sandeep-Kumar-family.ftree"),
            "application/octet-stream",
        )
        assertFalse("offered for a file it could not read", offeredFor(path))

        // And the boundary of the bargain: this app has no business in the list for a photograph.
        val photograph = Intent(Intent.ACTION_VIEW).setDataAndType(
            Uri.parse("content://media/external/images/media/12"),
            "image/jpeg",
        )
        assertFalse("offered for a photograph", offeredFor(photograph))
    }

    /** Starting the app from its own icon opens nothing: only a file handed over is a file opened. */
    @Test
    fun anOrdinaryLaunchOpensNothing() {
        assertNull(openedTree(Intent(Intent.ACTION_MAIN)))
        assertNull(openedTree(null))
        val uri = Uri.parse("content://example/tree.ftree")
        assertEquals(uri, openedTree(Intent(Intent.ACTION_VIEW).setData(uri)))
        assertEquals(
            uri,
            openedTree(Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM, uri))
        )
    }
}
