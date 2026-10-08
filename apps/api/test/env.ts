import { resetEnvForTest } from '../src/env';

const saved = new Map<string, string | undefined>();

/** Overrides env vars for one test (`undefined` unsets). Call `restoreEnv()` in afterEach. */
export const setEnv = (overrides: Record<string, string | undefined>): void => {
  for (const [key, value] of Object.entries(overrides)) {
    if (!saved.has(key)) saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetEnvForTest();
};

export const restoreEnv = (): void => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved.clear();
  resetEnvForTest();
};
