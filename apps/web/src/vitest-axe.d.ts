// vitest-axe ships its matcher type augmentation against the legacy `Vi`
// namespace, which Vitest 4 no longer uses — it augments the 'vitest' module's
// Assertion instead. Register toHaveNoViolations against the current target.
import type { AxeMatchers } from 'vitest-axe/matchers';
import 'vitest';

declare module 'vitest' {
  interface Assertion<T = unknown> extends AxeMatchers {}
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
