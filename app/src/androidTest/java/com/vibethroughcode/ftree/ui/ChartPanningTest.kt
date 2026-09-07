package com.vibethroughcode.ftree.ui

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.click
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipe
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import com.vibethroughcode.ftree.FTreeApplication
import com.vibethroughcode.ftree.MainActivity
import com.vibethroughcode.ftree.data.Person
import com.vibethroughcode.ftree.data.RelativeKind
import com.vibethroughcode.ftree.ui.tree.FamilyChartTag
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test

/**
 * Panning a chart that has been re-centred without the screen being rebuilt.
 *
 * The gesture that pans and zooms is built once and never rebuilt, so anything it closes over is
 * frozen at the moment the chart first appeared. It clamps the pan against the size of the drawing,
 * and holding a stale size meant the pan was kept inside the extent of a family that was no longer
 * on screen: the first drag after re-centring snapped the chart into that old window — a jump of
 * hundreds of points from a touch of twenty — and most of the real chart became unreachable.
 *
 * Reported from a real tree, and reproducible only through this exact shape: the chart has to be
 * built while showing a *small* family and then re-centred, in place, on a much larger one.
 * Re-centring from a person's page navigates, which rebuilds the screen and hides the fault.
 */
class ChartPanningTest {

    @get:Rule
    val rule = createAndroidComposeRule<MainActivity>()

    private val app: FTreeApplication
        get() = InstrumentationRegistry.getInstrumentation()
            .targetContext.applicationContext as FTreeApplication

    /** The chart opened on Padma is two cards; re-centred on Sunita it is thirty-one. */
    private val siblings = (1..31).map { "Sibling %02d".format(it) }
    private val middleSibling = siblings[19]

    @Before
    fun seed() {
        app.container.updatePreferences.setEnabled(false)
        app.container.database.clearAllTables()

        val repository = app.container.familyRepository
        runBlocking {
            val parent = Person(name = "Ram Prasad", birthDate = "1920")
            repository.addPerson(parent)
            siblings.forEachIndexed { index, name ->
                val child = Person(name = name, birthDate = (1945 + index).toString())
                repository.addPerson(child)
                repository.addRelative(child.id, parent.id, RelativeKind.PARENT)
                if (name == middleSibling) {
                    // Married in from outside: nobody else in this person's chart, so the chart
                    // built for them is the smallest one the app can draw.
                    val spouse = Person(name = "Padma", birthDate = "1960")
                    repository.addPerson(spouse)
                    repository.addRelative(spouse.id, child.id, RelativeKind.SPOUSE)
                }
            }
        }
        rule.waitUntil(10_000) {
            rule.onAllNodesWithTag(FamilyChartTag).fetchSemanticsNodes().isNotEmpty()
        }
    }

    /**
     * Waits for the chart to be the one asked for, rather than for Compose to merely look idle.
     *
     * Re-centring goes out through the graph and comes back as a new layout, and the framing that
     * follows is an effect of its own; `waitForIdle` returns before either. The chart says who it
     * is centred on in its own description, so that is what to wait on.
     */
    private fun centredOn(name: String) {
        rule.waitUntil(10_000) {
            rule.onAllNodesWithContentDescription("centred on $name", substring = true)
                .fetchSemanticsNodes().isNotEmpty()
        }
        rule.waitForIdle()
    }

    @Test
    fun aSmallDragDoesNotThrowARecentredChartOffTheScreen() {
        // The chart is built showing Padma, whose family is her husband and nobody else.
        rule.onNodeWithTag(NavPeopleTag).performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Padma").performScrollTo().performClick()
        rule.waitForIdle()
        rule.onNodeWithContentDescription("Show on the tree").performClick()
        centredOn("Padma")

        /*
         * Her husband is stacked directly under her, a couple's spacing away, and the pair are
         * centred on a chart that holds nothing else — so where he is can be worked out rather
         * than hunted for.
         */
        rule.onNodeWithTag(FamilyChartTag).performTouchInput {
            click(center + Offset(0f, 60.dp.toPx()))
        }
        rule.waitForIdle()
        rule.onNodeWithText("Centre the tree here").performClick()
        centredOn(middleSibling)

        /*
         * Re-centred, in place, on a chart thirty-one people tall, with him at the middle of it.
         * Choosing the action closed the sheet, so nothing is left over the chart — worth saying,
         * because an earlier version of this test dismissed the sheet by hand and passed without
         * the chart being asked anything: the sheet it read at the end was the one still open.
         */

        // A drag of twenty points is a third of a card. Whoever was under the middle of the screen
        // must still be under it.
        rule.onNodeWithTag(FamilyChartTag).performTouchInput {
            swipe(start = center, end = center - Offset(0f, 20.dp.toPx()), durationMillis = 200)
        }
        rule.waitForIdle()
        rule.onNodeWithTag(FamilyChartTag).performTouchInput { click(center) }
        rule.waitForIdle()

        assertTrue(
            "a twenty-point drag moved the chart far enough to lose the person under the middle " +
                "of the screen, so the pan was clamped against a family that is no longer drawn",
            rule.onAllNodesWithText("Open $middleSibling").fetchSemanticsNodes().isNotEmpty(),
        )
    }
}
