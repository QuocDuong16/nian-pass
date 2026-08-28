package dev.nian.pass

import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.security.KeyStore

class AutofillMetadataStoreInstrumentedTest {
  @Test
  fun realKeystoreRoundTripCorruptionMissingKeyAndDeleteFailClosed() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val alias = "nian-pass-autofill-metadata-instrumented-test"
    val fileName = "nian-pass-autofill-metadata-instrumented-test.bin"
    val store = AutofillMetadataStore(context, AndroidKeystoreAutofillCipher(alias), fileName)
    store.deleteBookmark()
    val metadata = AutofillMetadata("content://synthetic/vault", 1, "Synthetic.kdbx")
    assertTrue(store.saveBookmark(metadata))
    assertEquals(metadata, store.loadBookmark())

    val file = File(context.noBackupFilesDir, fileName)
    assertFalse(file.readBytes().toString(Charsets.ISO_8859_1).contains("content://synthetic"))
    file.writeBytes(file.readBytes().also { it[it.lastIndex] = (it.last().toInt() xor 1).toByte() })
    assertNull(store.loadBookmark())

    assertTrue(store.saveBookmark(metadata))
    KeyStore.getInstance("AndroidKeyStore").apply {
      load(null)
      deleteEntry(alias)
    }
    assertNull(store.loadBookmark())
    assertTrue(store.deleteBookmark())
    assertFalse(file.exists())
  }
}
