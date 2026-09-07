package com.vibethroughcode.ftree.ui

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.vibethroughcode.ftree.FTreeApplication
import com.vibethroughcode.ftree.MainActivity
import com.vibethroughcode.ftree.ui.settings.SettingsBetaConfirmTag
import com.vibethroughcode.ftree.ui.settings.SettingsBetaToggleTag
import com.vibethroughcode.ftree.ui.settings.SettingsUpdatesToggleTag
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Opting in to unfinished builds.
 *
 * The point of the tests is that it is hard to do by accident: it does nothing until ordinary update
 * checking is on, and it does not happen at all until somebody has read a dialog and agreed to it.
 */
@RunWith(AndroidJUnit4::class)
class BetaChannelFlowTest {

    @get:Rule
    val rule = createAndroidComposeRule<MainActivity>()

    private val app: FTreeApplication
        get() = InstrumentationRegistry.getInstrumentation()
            .targetContext.applicationContext as FTreeApplication

    private val preferences get() = app.container.updatePreferences

    @Before
    fun start() {
        preferences.setBetaChannel(false)
        preferences.setEnabled(false)
        rule.onNodeWithTag(NavSettingsTag).performClick()
    }

    @After
    fun leaveItOff() {
        preferences.setBetaChannel(false)
        preferences.setEnabled(false)
    }

    @Test
    fun itDoesNothingUntilUpdateCheckingIsOn() {
        rule.onNodeWithTag(SettingsBetaToggleTag).performScrollTo().assertIsDisplayed()
        rule.onNodeWithText("Turn on", substring = true).assertIsDisplayed()

        // The row is inert, so tapping it cannot turn anything on.
        rule.onNodeWithTag(SettingsBetaToggleTag).performClick()
        rule.onAllNodesWithText("Take unfinished builds?").assertCountEquals(0)
        assertFalse(preferences.betaChannel.value)
    }

    @Test
    fun turningItOnTakesReadingSomethingFirst() {
        rule.onNodeWithTag(SettingsUpdatesToggleTag).performScrollTo().performClick()

        rule.onNodeWithTag(SettingsBetaToggleTag).performScrollTo().performClick()
        rule.onNodeWithText("Take unfinished builds?").assertIsDisplayed()
        // The consequence somebody would otherwise only discover afterwards.
        rule.onNodeWithText("will not move you back", substring = true).assertIsDisplayed()
        rule.onNodeWithText("Export your tree before you install one.").assertIsDisplayed()

        // Backing out changes nothing.
        rule.onNodeWithText("Not now").performClick()
        assertFalse(preferences.betaChannel.value)
        rule.onNodeWithTag(SettingsBetaToggleTag).performScrollTo().assertIsOff()

        rule.onNodeWithTag(SettingsBetaToggleTag).performClick()
        rule.onNodeWithTag(SettingsBetaConfirmTag).performClick()
        assertTrue(preferences.betaChannel.value)
        rule.onNodeWithTag(SettingsBetaToggleTag).performScrollTo().assertIsOn()
    }

    @Test
    fun turningItOffIsNotAnInterruption() {
        preferences.setEnabled(true)
        preferences.setBetaChannel(true)

        rule.onNodeWithTag(SettingsBetaToggleTag).performScrollTo().performClick()

        rule.onAllNodesWithText("Take unfinished builds?").assertCountEquals(0)
        assertFalse(preferences.betaChannel.value)
    }
}
