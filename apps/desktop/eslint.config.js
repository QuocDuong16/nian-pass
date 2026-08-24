import eslint from "@eslint/js";
import globals from "globals";
import noUnsanitized from "eslint-plugin-no-unsanitized";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import security from "eslint-plugin-security";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "src-tauri/target"] },
  {
    linterOptions: {
      noInlineConfig: false,
      reportUnusedDisableDirectives: "error",
      reportUnusedInlineConfigs: "error",
    },
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "no-unsanitized": noUnsanitized,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      security,
    },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "no-console": "error",
      "no-restricted-globals": [
        "error",
        {
          name: "localStorage",
          message: "Browser persistence is forbidden for vault state.",
        },
        {
          name: "sessionStorage",
          message: "Browser persistence is forbidden for vault state.",
        },
        {
          name: "indexedDB",
          message: "Browser persistence is forbidden for vault state.",
        },
        {
          name: "caches",
          message: "Browser persistence is forbidden for vault state.",
        },
        {
          name: "CacheStorage",
          message: "Browser persistence is forbidden for vault state.",
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='eval']",
          message: "eval() is forbidden.",
        },
        {
          selector: "NewExpression[callee.name='Function']",
          message: "Function constructors are forbidden.",
        },
        {
          selector: "CallExpression[callee.name='Function']",
          message: "Function constructors are forbidden.",
        },
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: "dangerouslySetInnerHTML is forbidden.",
        },
        {
          selector:
            "CallExpression[callee.object.name='document'][callee.property.name='write']",
          message: "document.write() is forbidden.",
        },
        {
          selector:
            "MemberExpression[object.name=/^(window|globalThis)$/][property.name=/^(localStorage|sessionStorage|indexedDB|caches)$/]",
          message: "Browser persistence is forbidden for vault state.",
        },
        {
          selector:
            "MemberExpression[object.name='document'][property.name='cookie']",
          message: "Browser-managed cookies are forbidden for vault state.",
        },
        {
          selector:
            "MemberExpression[object.object.name=/^(window|globalThis)$/][object.property.name='document'][property.name='cookie']",
          message: "Browser-managed cookies are forbidden for vault state.",
        },
        {
          selector:
            "MemberExpression[object.name='navigator'][property.name='clipboard']",
          message:
            "Browser clipboard access is forbidden; use semantic Rust IPC commands.",
        },
        {
          selector:
            "MemberExpression[object.name='navigator'][computed=true][property.value='clipboard']",
          message:
            "Browser clipboard access is forbidden; use semantic Rust IPC commands.",
        },
        {
          selector:
            "MemberExpression[object.object.name=/^(window|globalThis)$/][object.property.name='navigator'][property.name='clipboard']",
          message:
            "Browser clipboard access is forbidden; use semantic Rust IPC commands.",
        },
      ],
      "no-unsanitized/method": "error",
      "no-unsanitized/property": "error",
      "react-refresh/only-export-components": [
        "error",
        { allowConstantExport: true },
      ],
      "security/detect-disable-mustache-escape": "error",
      "security/detect-eval-with-expression": "error",
      "security/detect-new-buffer": "error",
      "security/detect-pseudoRandomBytes": "error",
      "security/detect-unsafe-regex": "error",
    },
  },
);
