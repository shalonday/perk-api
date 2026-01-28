/**
 * Jest setup file
 * Configure global test settings
 */

// Suppress console output during tests unless they fail
const originalLog = console.log;
const originalError = console.error;

beforeAll(() => {
  // Re-enable for debugging if needed
  // console.log = originalLog;
  // console.error = originalError;
});

afterAll(() => {
  console.log = originalLog;
  console.error = originalError;
});

// Set test timeout
jest.setTimeout(30000);
