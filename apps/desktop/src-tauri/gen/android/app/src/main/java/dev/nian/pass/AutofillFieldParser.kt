package dev.nian.pass

import android.app.assist.AssistStructure
import android.text.InputType
import android.view.View
import android.view.autofill.AutofillId

internal enum class AutofillFieldRole { USERNAME, PASSWORD, IGNORE }

internal data class AutofillFieldModel(
  val hints: List<String>,
  val inputType: Int,
  val htmlType: String?,
)

internal object AutofillFieldClassifier {
  private val usernameHints = setOf(
    View.AUTOFILL_HINT_USERNAME.lowercase(),
    View.AUTOFILL_HINT_EMAIL_ADDRESS.lowercase(),
    "email",
    "emailaddress",
  )
  private val passwordHints = setOf(
    View.AUTOFILL_HINT_PASSWORD.lowercase(),
    "current-password",
  )

  fun classify(model: AutofillFieldModel): AutofillFieldRole {
    val hints = model.hints.map(String::lowercase)
    val htmlType = model.htmlType?.lowercase()
    val variation = model.inputType and InputType.TYPE_MASK_VARIATION
    if (
      hints.any(passwordHints::contains) ||
      htmlType == "password" ||
      variation == InputType.TYPE_TEXT_VARIATION_PASSWORD ||
      variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD ||
      variation == InputType.TYPE_NUMBER_VARIATION_PASSWORD
    ) return AutofillFieldRole.PASSWORD
    if (
      hints.any(usernameHints::contains) ||
      htmlType == "email" ||
      variation == InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS ||
      variation == InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS
    ) return AutofillFieldRole.USERNAME
    return AutofillFieldRole.IGNORE
  }
}

internal data class ParsedAssistRequest(
  val fields: ParsedAutofillFields,
  val webDomain: String?,
)

internal object AssistStructureParser {
  fun parse(structure: AssistStructure): ParsedAssistRequest? {
    val usernames = mutableListOf<AutofillId>()
    val passwords = mutableListOf<AutofillId>()
    var webDomain: String? = null
    for (windowIndex in 0 until structure.windowNodeCount) {
      traverse(structure.getWindowNodeAt(windowIndex).rootViewNode) { node ->
        if (webDomain == null) webDomain = node.webDomain
        val id = node.autofillId ?: return@traverse
        val htmlType = node.htmlInfo?.attributes
          ?.firstOrNull { it.first.equals("type", ignoreCase = true) }
          ?.second
        when (
          AutofillFieldClassifier.classify(
            AutofillFieldModel(node.autofillHints?.toList().orEmpty(), node.inputType, htmlType),
          )
        ) {
          AutofillFieldRole.USERNAME -> usernames += id
          AutofillFieldRole.PASSWORD -> passwords += id
          AutofillFieldRole.IGNORE -> Unit
        }
      }
    }
    if (passwords.isEmpty()) return null
    return ParsedAssistRequest(
      ParsedAutofillFields(usernames.distinct(), passwords.distinct()),
      webDomain?.trim()?.takeIf { it.isNotEmpty() },
    )
  }

  private inline fun traverse(
    root: AssistStructure.ViewNode,
    crossinline visit: (AssistStructure.ViewNode) -> Unit,
  ) {
    val stack = ArrayDeque<AssistStructure.ViewNode>()
    stack.add(root)
    while (stack.isNotEmpty()) {
      val node = stack.removeLast()
      visit(node)
      for (index in 0 until node.childCount) stack.add(node.getChildAt(index))
    }
  }
}
