import cds from "@sap/cds/eslint.config.mjs";

export default [
  ...cds.recommended,
  {
    ignores: ["node_modules/**", "_out/**", "coverage/**", ".git/**"]
  },
  {
    files: ["app/**/*.js"],
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        fetch: "readonly",
        sap: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly"
      }
    }
  },
  {
    files: ["srv/**/*.js", "scripts/**/*.js", "test/**/*.js"],
    rules: {
      "no-console": "off"
    }
  },
  {
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }]
    }
  }
];
