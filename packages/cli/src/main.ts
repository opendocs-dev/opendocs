#!/usr/bin/env bun
/**
 * OpenDocs CLI entry point. Plain argv switch, no CLI framework.
 */
import pkg from '../package.json' with { type: 'json' };
import { login } from './commands/login';
import { logout } from './commands/logout';
import { toWebp } from './compress';
import { startMcp } from './mcp';
import { REDACT_MODES, saveUserMode } from './redact/enforce';

const USAGE = `opendocs ${pkg.version}

Usage:
  opendocs login --key <key>          Save an API key for this machine
  opendocs logout                     Remove the stored API key
  opendocs config redact <mode>       Save the default redaction mode (strict, basic, off)
  opendocs mcp                        Start the MCP server (stdio)
  opendocs --version                  Print the CLI version`;

/** `opendocs config redact <strict|basic|off>` */
async function configRedact(mode: string | undefined): Promise<number> {
  if (!mode) {
    process.stderr.write('usage: opendocs config redact <strict|basic|off>\n');
    return 1;
  }
  if (!(REDACT_MODES as readonly string[]).includes(mode)) {
    process.stderr.write(`unknown redact mode "${mode}": use strict, basic or off\n`);
    return 1;
  }
  await saveUserMode(mode as (typeof REDACT_MODES)[number]);
  process.stdout.write(`redact mode set to ${mode}\n`);
  return 0;
}

/** Hidden command used by CI to smoke-test each compiled binary. */
async function smokeEncode(path: string | undefined): Promise<number> {
  if (!path) {
    process.stderr.write('error: smoke-encode requires a file path\n');
    return 1;
  }
  try {
    const input = await Bun.file(path).bytes();
    const output = await toWebp(input);
    process.stdout.write(`ok ${output.length}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`error: ${message}\n`);
    return 1;
  }
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  switch (command) {
    case '--version':
    case '-v':
      process.stdout.write(`${pkg.version}\n`);
      return 0;
    case 'login':
      return await login(rest);
    case 'logout':
      return await logout(rest);
    case 'config':
      if (rest[0] === 'redact') return await configRedact(rest[1]);
      process.stdout.write(`${USAGE}\n`);
      return 1;
    case 'mcp':
      await startMcp();
      return 0;
    case 'smoke-encode':
      return await smokeEncode(rest[0]);
    default:
      process.stdout.write(`${USAGE}\n`);
      return 1;
  }
}

process.exit(await main(process.argv.slice(2)));
