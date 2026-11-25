// The checker for tests/ (scripts/typecheck-tests.mjs) keeps only the mistakes that mean a test is
// not testing what it says; here on sample tsc output (the whole run is `npm run typecheck:tests`).
import { describe, expect, it } from 'vitest';
import { onlyKinds } from '../scripts/typecheck-tests.mjs';

describe('typecheck-tests', () => {
  it('keeps a duplicate import, a missing name and a missing module, and drops looser complaints', () => {
    const out = [
      "tests/a.test.ts(3,10): error TS2300: Duplicate identifier 'foo'.",
      "tests/b.test.ts(4,1): error TS2304: Cannot find name 'bar'.",
      "tests/c.test.ts(1,20): error TS2307: Cannot find module '../src/x' or its corresponding type declarations.",
      "tests/d.test.ts(9,5): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.",
      "tests/e.test.ts(2,8): error TS7006: Parameter 'x' implicitly has an 'any' type.",
    ].join('\n');
    expect(onlyKinds(out).map((l) => l.split(':')[0])).toEqual(['tests/a.test.ts(3,10)', 'tests/b.test.ts(4,1)', 'tests/c.test.ts(1,20)']);
  });
});
