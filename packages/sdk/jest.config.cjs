module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', '/tests/browser/'],
  roots: ['<rootDir>/src'],
};
