module.exports = {
  testEnvironment: "node",
  collectCoverageFrom: [
    "services/**/*.js",
    "scripts/**/*.js",
    "!node_modules/**",
  ],
  coveragePathIgnorePatterns: ["/node_modules/"],
  testMatch: ["**/__tests__/**/*.test.js"],
  verbose: true,
  testTimeout: 30000,
  setupFilesAfterEnv: ["<rootDir>/__tests__/setup.js"],
};
