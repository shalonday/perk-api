# Test File Copilot Instructions

When writing or renaming tests in this folder, name each `test()` / `it()` description in this form:

`functionCall(input1, input2) => expectedResult`

Use the actual function or method name, include the specific inputs under test, and separate inputs from the expected outcome with `=>`.

Examples:

- `isAllowedDomain('example.com', DEFAULT_ALLOWED_DOMAINS) => false`
- `validateIngestUrl('https://example.com/learn', mockRes) => { url: new URL('https://example.com/learn') }`
- `normalizeHostname('https://www.example.com/path') => 'example.com'`

Keep this style consistent for new tests and when updating existing test descriptions in this folder.
