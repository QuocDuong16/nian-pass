import eslint from "@eslint/js";
import globals from "globals";
import noUnsanitized from "eslint-plugin-no-unsanitized";
import security from "eslint-plugin-security";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "coverage"] },
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
    files: ["**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "no-unsanitized": noUnsanitized, security },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "no-console": "error",
      "no-eval": "error",
      "no-new-func": "error",
      "no-unsanitized/method": "error",
      "no-unsanitized/property": "error",
      "security/detect-disable-mustache-escape": "error",
      "security/detect-eval-with-expression": "error",
      "security/detect-new-buffer": "error",
      "security/detect-pseudoRandomBytes": "error",
      "security/detect-unsafe-regex": "error",
    },
  },
  {
    files: ["src/**/*.test.ts", "src/test/**/*.ts"],
    rules: {
      "@typescript-eslint/require-await": "off",
      "no-unsanitized/method": "off",
      "no-unsanitized/property": "off",
    },
  },
  {
    files: ["src/content/field-registry.ts"],
    rules: {
      "@typescript-eslint/unbound-method": "off",
    },
  },
);
