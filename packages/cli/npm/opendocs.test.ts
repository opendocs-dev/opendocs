import { describe, expect, test } from 'bun:test';
import { platformPackage } from './opendocs.js';

describe('platformPackage', () => {
  test('maps each supported platform to its package', () => {
    expect(platformPackage('darwin', 'arm64')).toBe('opendocs-cli-darwin-arm64');
    expect(platformPackage('darwin', 'x64')).toBe('opendocs-cli-darwin-x64');
    expect(platformPackage('linux', 'x64')).toBe('opendocs-cli-linux-x64');
    expect(platformPackage('linux', 'arm64')).toBe('opendocs-cli-linux-arm64');
    expect(platformPackage('win32', 'x64')).toBe('opendocs-cli-windows-x64');
  });

  test('unsupported platform names the package and fails', () => {
    expect(platformPackage('freebsd', 'x64')).toBe(null);
    expect(platformPackage('linux', 'ia32')).toBe(null);
  });
});
