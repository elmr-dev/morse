// DOM-test setup: registers jest-dom matchers (toBeInTheDocument, …) and
// vitest-axe's toHaveNoViolations. Loaded only by the 'dom' vitest project.
import { expect } from 'vitest';
import * as axeMatchers from 'vitest-axe/matchers';
import '@testing-library/jest-dom/vitest';

// vitest-axe 0.1's extend-expect entry is a no-op build, so register manually.
expect.extend(axeMatchers);
