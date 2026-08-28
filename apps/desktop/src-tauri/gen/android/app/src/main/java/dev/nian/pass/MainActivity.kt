package dev.nian.pass

import android.os.Bundle
import androidx.activity.enableEdgeToEdge

open class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }
}
