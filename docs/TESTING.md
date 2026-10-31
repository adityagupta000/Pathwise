# Testing Guide

PathWise includes a comprehensive test suite covering critical functionality.

## Test Overview

- **Framework:** Vitest
- **Total Tests:** 50
- **Coverage Areas:** Evidence validation, dependency resolution, translation, extraction pipeline
- **Test Files:** `*.test.js` files in `/lib` directory

## Running Tests

### Run All Tests

```bash
npm test
```

### Watch Mode (Re-run on File Changes)

```bash
npm run test:watch
```

### Interactive UI

```bash
npm run test:ui
```

Opens a web interface at `http://localhost:51204` showing test results, coverage, and file changes.

### Run Specific Test File

```bash
npx vitest run lib/validation.test.js
```

### Run Tests Matching Pattern

```bash
npx vitest run -t "validates page"
```

## Test Structure

### Test Files

```
lib/
├── validation.test.js       # Evidence validation (17 tests)
├── engines.test.js          # Dependency & priority (10 tests)
├── sarvam.test.js          # Translation chunking (13 tests)
└── extraction.test.js       # Extraction pipeline (10 tests)
```

### Test Categories

#### 1. Evidence Validation Tests (`validation.test.js`)

**Purpose:** Verify that model-generated evidence is actually present in source documents.

**Tests:**

- Page number validation (6 tests)
- Evidence snippet matching (7 tests)
- Full extraction validation (4 tests)

**Key Scenarios:**

```javascript
// Example: Valid page reference
validateSourcePage("Page 3", 5);
// Returns: { valid: true, reason: "Page 3 exists" }

// Invalid page reference
validateSourcePage("Page 10", 5);
// Returns: { valid: false, reason: "References page 10 but document only has 5 pages" }

// Evidence found in source
validateEvidenceSnippet("visit the Aadhaar Kendra", sourceText);
// Returns: { valid: true, reason: "Evidence found in source", foundAt: 42 }
```

#### 2. Dependency Resolution Tests (`engines.test.js`)

**Purpose:** Ensure dependency detection works correctly without false positives.

**Tests:**

- Exact prerequisite matching (1 test)
- Generic word prevention (1 test)
- Cycle detection (1 test)
- No dependencies handling (1 test)
- Fuzzy matching with evidence (1 test)
- Priority ordering (5 tests)

**Key Scenarios:**

```javascript
// Example: Exact match
resolveDependencies([
  { id: "doc1", required_action: "Update Aadhaar", prerequisites: [] },
  {
    id: "doc2",
    required_action: "Bank KYC",
    prerequisites: ["Update Aadhaar"],
  },
]);
// Result: doc2 is blocked by doc1

// Prevent false positive from generic term
resolveDependencies([
  { id: "doc1", required_action: "Update Aadhaar", prerequisites: [] },
  { id: "doc2", required_action: "Update Bank", prerequisites: ["Update"] },
]);
// Result: doc2 NOT blocked (generic term rejected)
```

#### 3. Translation Tests (`sarvam.test.js`)

**Purpose:** Ensure text chunking preserves content and respects API limits.

**Tests:**

- Short text handling (1 test)
- Paragraph boundary splitting (1 test)
- Long paragraph splitting (1 test)
- Max chunk size enforcement (1 test)
- Devanagari terminators (1 test)
- Paragraph structure preservation (1 test)
- Empty/whitespace handling (1 test)
- JSON parsing (6 tests)

**Key Scenarios:**

```javascript
// Example: Long text split into chunks
chunkText("A".repeat(5000), 1800);
// Returns: ['AAAA...(1800 chars)', 'AAAA...(1800 chars)', 'AAAA...(1400 chars)']

// Paragraph boundaries preserved
chunkText("Para 1\n\nPara 2\n\nPara 3", 50);
// Returns: Each paragraph stays intact (not split mid-paragraph)
```

#### 4. Extraction Pipeline Tests (`extraction.test.js`)

**Purpose:** Validate document message formatting and truncation handling.

**Tests:**

- Single document formatting (1 test)
- Multiple document formatting (1 test)
- Long document truncation (1 test)
- Short document handling (1 test)
- Empty document handling (1 test)
- System prompt generation (5 tests)

**Key Scenarios:**

```javascript
// Example: Truncation tracking
buildUserMessage([{ text: "A".repeat(70000), fileName: "long.txt" }]);
// Returns: {
//     message: '...AAAA...[...document truncated...]',
//     truncations: [{ fileName: 'long.txt', originalLength: 70000, truncatedLength: 60000 }]
//   }
//   }
```

## Writing Tests

### Test File Template

```javascript
import { describe, it, expect } from "vitest";
import { functionToTest } from "./module.js";

describe("Module Name", () => {
  describe("functionToTest", () => {
    it("handles normal case", () => {
      const result = functionToTest("input");
      expect(result).toBe("expected");
    });

    it("handles edge case", () => {
      const result = functionToTest(null);
      expect(result).toBe(null);
    });
  });
});
```

### Assertion Examples

```javascript
// Equality
expect(value).toBe(42); // Strict equality (===)
expect(value).toEqual({ key: "value" }); // Deep equality

// Truthiness
expect(value).toBeTruthy();
expect(value).toBeFalsy();
expect(value).toBeNull();
expect(value).toBeUndefined();

// Numbers
expect(value).toBeGreaterThan(10);
expect(value).toBeLessThanOrEqual(100);

// Arrays
expect(array).toHaveLength(5);
expect(array).toContain("item");

// Strings
expect(string).toContain("substring");
expect(string).toMatch(/pattern/);

// Objects
expect(obj).toHaveProperty("key");
expect(obj.key).toBe("value");

// Functions
expect(() => fn()).toThrow();
expect(() => fn()).toThrow("error message");
```

### Mocking (If Needed)

Vitest supports mocking, though current tests don't use it:

```javascript
import { vi } from "vitest";

// Mock function
const mockFn = vi.fn();
mockFn.mockReturnValue("mocked");

// Mock module
vi.mock("./sarvam.js", () => ({
  translateText: vi.fn().mockResolvedValue("translated"),
}));
```

## Test Coverage

Current coverage focuses on:

- Evidence validation - Critical for accuracy
- Dependency logic - Core feature
- Translation chunking - Prevents data loss
- Extraction pipeline - Input handling

**Not yet covered:**

- API route integration tests
- UI component tests
- End-to-end workflows
- Sarvam API integration tests (require live API)

## Continuous Integration

### Local Pre-Commit

Add to `.git/hooks/pre-commit`:

```bash
#!/bin/sh
npm test
if [ $? -ne 0 ]; then
  echo "Tests failed. Commit aborted."
  exit 1
fi
```

### GitHub Actions (Example)

Create `.github/workflows/test.yml`:

```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: npm ci
      - run: npm test
```

## Performance Testing

Tests run in ~400ms total. Individual test suites:

- `validation.test.js`: ~23ms
- `engines.test.js`: ~26ms
- `sarvam.test.js`: ~8ms
- `extraction.test.js`: ~17ms

### Benchmarking

```bash
# Run with timing
npx vitest run --reporter=verbose

# Profile slow tests
npx vitest run --reporter=verbose --slowTestThreshold=100
```

## Debugging Tests

### Run Single Test in Debug Mode

```javascript
// Add .only to focus on one test
it.only("specific test", () => {
  // Only this test runs
});
```

### Add Debug Output

```javascript
it("test with debugging", () => {
  const result = functionToTest(input);
  console.log("Result:", result); // Shows in test output
  expect(result).toBe(expected);
});
```

### VS Code Debugging

Add to `.vscode/launch.json`:

```json
{
  "type": "node",
  "request": "launch",
  "name": "Debug Tests",
  "runtimeExecutable": "npm",
  "runtimeArgs": ["test"],
  "console": "integratedTerminal"
}
```

## Common Issues

### ESM Module Warnings

```
(!) Your Vite config uses features that are unsupported...
```

**Solution:** Ignore this warning or rename `vitest.config.js` to `vitest.config.mjs`

### Test Timeout

```
Test timed out after 5000ms
```

**Solution:** Increase timeout for slow tests:

```javascript
it("slow test", async () => {
  // Test code
}, 10000); // 10 second timeout
```

### Import Path Errors

```
Cannot find module '@/lib/...'
```

**Solution:** Check `vitest.config.js` alias configuration matches `jsconfig.json`

## Best Practices

### Do

- Test edge cases (null, empty, large inputs)
- Test error conditions
- Use descriptive test names
- Keep tests independent (no shared state)
- Mock external APIs (Sarvam calls)
- Test public interfaces, not implementation details

### Don't

- Test private functions directly
- Share state between tests
- Make real API calls in tests
- Write tests that depend on execution order
- Ignore failing tests

## Adding New Tests

When adding new features:

1. **Write test first** (TDD approach):

   ```javascript
   it("new feature works", () => {
     expect(newFeature()).toBe(expected);
   });
   ```

2. **Implement feature** until test passes

3. **Add edge cases**:

   ```javascript
   it("handles null input", () => {
     expect(newFeature(null)).toBe(null);
   });
   ```

4. **Run full test suite**:
   ```bash
   npm test
   ```

## Next Steps

- [Development Guide](DEVELOPMENT.md) - Set up dev environment
- [API Reference](API_REFERENCE.md) - Test API endpoints
- [Contributing](CONTRIBUTING.md) - Submit improvements
