package com.vibethroughcode.ftree.ui

import androidx.compose.ui.test.DeviceConfigurationOverride
import androidx.compose.ui.test.ForcedSize
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.vibethroughcode.ftree.FTreeApplication
import com.vibethroughcode.ftree.data.Person
import com.vibethroughcode.ftree.ui.people.PeopleCountTag
import com.vibethroughcode.ftree.ui.people.PeopleScreen
import com.vibethroughcode.ftree.ui.settings.SettingsScreen
import com.vibethroughcode.ftree.ui.theme.FTreeTheme
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.math.abs

/**
 * That a window wider than one column of reading matter is used rather than left half empty.
 *
 * This is the shape of a bug that has been reported twice: a landscape phone showing three names
 * beside two hundred points of nothing, and a tablet that would show the same thing worse. Both
 * screens are laid out at a *forced* size rather than by rotating the device, so the test says the
 * same thing on a phone, on a tablet and on whatever the emulator happens to be.
 */
@RunWith(AndroidJUnit4::class)
class WideWindowLayoutTest {

    @get:Rule
    val rule = createComposeRule()

    private val app: FTreeApplication
        get() = InstrumentationRegistry.getInstrumentation()
            .targetContext.applicationContext as FTreeApplication

    @Before
    fun seedFourPeople() {
        app.container.updatePreferences.setEnabled(false)
        app.container.database.clearAllTables()
        runBlocking {
            listOf("Aarav Verma", "Bhavna Verma", "Chandra Verma", "Devika Verma").forEach {
                app.container.familyRepository.addPerson(Person(name = it, birthDate = "1960"))
            }
        }
    }

    private fun people(width: Int, height: Int = 420) = rule.setContent {
        DeviceConfigurationOverride(
            DeviceConfigurationOverride.ForcedSize(DpSize(width.dp, height.dp))
        ) {
            FTreeTheme { PeopleScreen(onOpenPerson = {}, onAddPerson = {}) }
        }
    }

    @Test
    fun a_landscape_phone_reads_the_list_in_two_columns() {
        people(width = 750)

        val first = rule.onNodeWithText("Aarav Verma").getBoundsInRoot()
        val second = rule.onNodeWithText("Bhavna Verma").getBoundsInRoot()

        assertTrue(
            "the second name is below the first rather than beside it",
            abs((first.top - second.top).value) < 1f,
        )
        assertTrue("the second name is not to the right of the first", second.left > first.left)
    }

    @Test
    fun an_upright_phone_still_reads_the_list_in_one() {
        people(width = 411, height = 900)

        val first = rule.onNodeWithText("Aarav Verma").getBoundsInRoot()
        val second = rule.onNodeWithText("Bhavna Verma").getBoundsInRoot()

        assertEquals("the names are side by side on a narrow window", first.left, second.left)
        assertTrue("the second name is not under the first", second.top > first.top)
    }

    /**
     * The failure the whole change is about: not *how* the width is divided, but that all of it is
     * used. A column stopping short of the far edge is the band of nothing that was reported.
     */
    @Test
    fun the_columns_reach_the_far_edge_of_a_tablet() {
        people(width = 1280, height = 800)

        // The count belongs to the whole list, so it spans every column: its right edge is where
        // the columns end, and the band of nothing that was reported is the gap after it. It sets
        // its own twenty points of padding, so that much short of the edge is the text, not a gap.
        val underneath = rule.onNodeWithTag(PeopleCountTag).getBoundsInRoot()
        val short = 1280 - underneath.right.value
        assertTrue("the list stops $short points short of the far edge", short <= 21f)

        // And it really is more than two columns: the third name starts past two thirds across.
        val third = rule.onNodeWithText("Chandra Verma").getBoundsInRoot()
        assertTrue("there is no third column", third.left.value > 1280 * 2 / 3f - 60f)
    }

    @Test
    fun settings_sections_stand_beside_each_other_on_a_wide_window() {
        rule.setContent {
            DeviceConfigurationOverride(
                DeviceConfigurationOverride.ForcedSize(DpSize(900.dp, 500.dp))
            ) {
                FTreeTheme {
                    SettingsScreen(
                        onExport = {},
                        onImport = {},
                        viewModel = viewModel(factory = FTreeViewModels.Factory),
                    )
                }
            }
        }

        val words = rule.onNodeWithText("FAMILY WORDS").getBoundsInRoot()
        val chart = rule.onNodeWithText("CHART").getBoundsInRoot()

        assertTrue("the chart section is below the words section, not beside it",
            abs((words.top - chart.top).value) < 1f)
        assertTrue("the chart section is not to the right of the words section",
            chart.left > words.left)
    }
}
