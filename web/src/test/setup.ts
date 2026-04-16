import '@testing-library/jest-dom/vitest';

// Minimal localStorage mock (jsdom provides one but ensure it's clean between tests)
beforeEach(() => {
  localStorage.clear();
});
