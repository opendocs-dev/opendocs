import { EnvError, getEnv } from './env';

/**
 * Imported first by index.ts: a bad env must stop the process with a readable message
 * before any module that reads it (auth, storage) is evaluated.
 */
try {
  getEnv();
} catch (error) {
  if (!(error instanceof EnvError)) throw error;
  console.error(error.message);
  process.exit(1);
}
