package dev.nian.pass

import android.content.Intent
import android.os.Build
import android.view.WindowManager
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.lifecycle.Lifecycle
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MobileSecurityInstrumentedTest {
  @Test
  fun mainActivityHasSecureWindowAndHandshakeControlledCurtain() {
    ActivityScenario.launch(MainActivity::class.java).use { scenario ->
      scenario.onActivity { activity ->
        assertTrue(
          activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0,
        )
        assertTrue(MobileSecurityRuntime.hasCurtain(activity))
        val status = MobileSecurityRuntime.status(activity)
        if (
          status.foreground &&
          status.activityResumed &&
          status.windowFocused &&
          status.screenState == MobileScreenState.ACTIVE
        ) {
          assertTrue(MobileSecurityRuntime.acknowledgeSafeUi(activity, status.generation))
          assertFalse(MobileSecurityRuntime.hasCurtain(activity))
        }
        assertTrue(
          !RecentsProtectionPolicy.shouldDisableScreenshots(Build.VERSION.SDK_INT) ||
            Build.VERSION.SDK_INT >= 33,
        )
      }
    }
  }

  @Test
  fun activityPauseKeepsCurtainAndRejectsPriorGeneration() {
    var priorGeneration = -1L
    ActivityScenario.launch(MainActivity::class.java).use { scenario ->
      scenario.onActivity { activity ->
        priorGeneration = MobileSecurityRuntime.status(activity).generation
      }
      scenario.moveToState(Lifecycle.State.CREATED)
      scenario.moveToState(Lifecycle.State.RESUMED)
      scenario.onActivity { activity ->
        val resumed = MobileSecurityRuntime.status(activity)
        assertTrue(resumed.generation > priorGeneration)
        assertTrue(MobileSecurityRuntime.hasCurtain(activity))
        assertFalse(MobileSecurityRuntime.acknowledgeSafeUi(activity, priorGeneration))
      }
    }
  }

  @Test
  fun credentialActivityInheritsSecureWindowAndNativeCurtain() {
    val intent = Intent(
      androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().targetContext,
      CredentialActivity::class.java,
    )
    ActivityScenario.launch<CredentialActivity>(intent).use { scenario ->
      scenario.onActivity { activity ->
        assertTrue(
          activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0,
        )
        assertTrue(MobileSecurityRuntime.hasCurtain(activity))
      }
    }
  }
}
