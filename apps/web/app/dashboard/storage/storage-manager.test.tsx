import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  StorageManager,
  canDisconnect,
  getDisconnectConfirmMessage,
  DISCONNECT_WARNING_MESSAGE,
} from './storage-manager';
import type { StorageInfo } from '@/lib/server-api';

const freeStorage: StorageInfo = {
  plan: 'free',
  allowed_kinds: [],
  active_kind: null,
  connections: [],
};

const freeStorageWithUsage: StorageInfo = {
  plan: 'free',
  allowed_kinds: [],
  active_kind: null,
  connections: [],
  usage: {
    bytes_used: 62 * 1024 * 1024,
    bytes_limit: 100 * 1024 * 1024,
  },
};

const proStorage: StorageInfo = {
  plan: 'pro',
  allowed_kinds: ['gdrive'],
  active_kind: null,
  connections: [],
};

const enterpriseStorage: StorageInfo = {
  plan: 'enterprise',
  allowed_kinds: ['gdrive', 's3'],
  active_kind: 'gdrive',
  connections: [
    { kind: 'gdrive', config: { folderId: 'abc123' }, status: 'connected', last_tested_at: '2026-10-01T00:00:00.000Z' },
  ],
};

const failedActiveStorage: StorageInfo = {
  plan: 'enterprise',
  allowed_kinds: ['gdrive', 's3'],
  active_kind: 'gdrive',
  connections: [
    { kind: 'gdrive', config: { folderId: 'abc123' }, status: 'failed', last_tested_at: '2026-10-01T00:00:00.000Z' },
  ],
};

describe('StorageManager', () => {
  test('renders top info callout about existing stored images', () => {
    const html = renderToStaticMarkup(<StorageManager initial={freeStorage} />);
    expect(html).toContain('Images already stored stay where they are. Guides keep working when you switch.');
  });

  test('Free plan shows OpenDocs storage with Default and Active badges and usage meter', () => {
    const html = renderToStaticMarkup(<StorageManager initial={freeStorage} />);
    expect(html).toContain('OpenDocs storage');
    expect(html).toContain('Default');
    expect(html).toContain('Active');
    expect(html).toContain('0 of 100 MiB used');
    expect(html).toContain('role="progressbar"');
  });

  test('renders live OpenDocs storage usage when provided', () => {
    const html = renderToStaticMarkup(<StorageManager initial={freeStorageWithUsage} />);
    expect(html).toContain('62 of 100 MiB used');
  });

  test('Free plan shows locked veils for Google Drive and S3 instead of old Connect your own storage card', () => {
    const html = renderToStaticMarkup(<StorageManager initial={freeStorage} />);
    expect(html).not.toContain('Connect your own storage');
    expect(html).toContain('Your own Google Drive is on Pro');
    expect(html).toContain('Keep guide images in your Drive.');
    expect(html).toContain('S3 storage is on Enterprise');
    expect(html).toContain('card-lock is-locked');
  });

  test('Pro plan shows Drive connect form unlocked and S3 locked with Enterprise veil', () => {
    const html = renderToStaticMarkup(<StorageManager initial={proStorage} />);
    expect(html).toContain('Connect Google Drive');
    expect(html).toContain('S3 storage is on Enterprise');
    expect(html).toContain('card-lock is-locked');
  });

  test('Enterprise plan shows both Drive and S3 connect affordances unlocked', () => {
    const html = renderToStaticMarkup(<StorageManager initial={enterpriseStorage} />);
    expect(html).toContain('Google Drive');
    expect(html).toContain('S3-compatible bucket');
    expect(html).not.toContain('card-lock is-locked');
    expect(html).toContain('Test connection');
    expect(html).toContain('Disconnect');
    expect(html).toContain('Connect S3-compatible storage');
  });

  test('S3 card always shows Enterprise badge even when unlocked', () => {
    const html = renderToStaticMarkup(<StorageManager initial={enterpriseStorage} />);
    expect(html).toContain('Enterprise');
  });

  test('S3 form renders with two-column grid, new field labels and switch toggle', () => {
    const html = renderToStaticMarkup(<StorageManager initial={enterpriseStorage} />);
    expect(html).toContain('grid2');
    expect(html).toContain('Folder prefix');
    expect(html).toContain('Leave empty for AWS');
    expect(html).toContain('Use path-style URLs');
    expect(html).toContain('Needed by some S3-compatible services.');
    expect(html).toContain('switch');
    expect(html).toContain('Not connected yet. Test the connection before saving.');
  });

  test('shows the active connection kind as the current destination', () => {
    const html = renderToStaticMarkup(<StorageManager initial={enterpriseStorage} />);
    expect(html).toContain('Google Drive');
    expect(html).toContain('badge-ok');
  });

  test('surfaces a visible failure warning when the active connection failed its last test, never silently falling back', () => {
    const html = renderToStaticMarkup(<StorageManager initial={failedActiveStorage} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('failed its last test');
    expect(html).toContain('not');
  });

  test('no failure warning when the active connection is healthy', () => {
    const html = renderToStaticMarkup(<StorageManager initial={enterpriseStorage} />);
    expect(html).not.toContain('failed its last test');
  });

  // Finding 3 (Owner decision): Radio group "Where new images go" replaces Current destination card and per-card Activate buttons
  test('replaces Current destination card and per-card Activate buttons with header Save and Where new images go radio card', () => {
    const html = renderToStaticMarkup(<StorageManager initial={enterpriseStorage} />);
    expect(html).not.toContain('<h3>Current destination</h3>');
    expect(html).not.toContain('Activate');
    expect(html).toContain('Save');
    expect(html).toContain('Where new images go');
    expect(html).toContain('OpenDocs storage');
    expect(html).toContain('My Google Drive');
    expect(html).toContain('My S3 bucket');
  });

  test('Where new images go allows only connected providers to be selected', () => {
    // In freeStorage: no connections, so OpenDocs is selected, Drive and S3 are disabled
    const freeHtml = renderToStaticMarkup(<StorageManager initial={freeStorage} />);
    expect(freeHtml).toContain('checked="" value="opendocs"');
    expect(freeHtml).toContain('disabled="" name="destination" value="gdrive"');
    expect(freeHtml).toContain('disabled="" name="destination" value="s3"');

    // In enterpriseStorage: Drive is connected and active, S3 is not connected
    const entHtml = renderToStaticMarkup(<StorageManager initial={enterpriseStorage} />);
    expect(entHtml).toContain('checked="" value="gdrive"');
    expect(entHtml).not.toContain('disabled="" name="destination" value="gdrive"');
    expect(entHtml).toContain('disabled="" name="destination" value="s3"');
  });

  // Finding 8 (Owner decision): Standing unreachable storage warning without promising email to owner
  test('Where new images go displays standing unreachable storage warning without promising email to owner', () => {
    const html = renderToStaticMarkup(<StorageManager initial={freeStorage} />);
    expect(html).toContain(
      'If your storage is unreachable, images stop loading until it is back. OpenDocs shows a warning here.'
    );
    expect(html).not.toContain('emails the owner');
  });

  // Finding 15 (Owner decision): Reword disconnect confirm & block disconnecting the active destination
  test('reworded disconnect confirm message warns images will stop loading without silent fallback', () => {
    const msg = getDisconnectConfirmMessage('gdrive');
    expect(msg).toContain('Disconnect Google Drive?');
    expect(msg).toContain(DISCONNECT_WARNING_MESSAGE);
    expect(msg).toContain(
      'Images already stored there will stop loading and new uploads will fail until you choose another destination.'
    );
    expect(msg).not.toContain('fall back to OpenDocs storage');
  });

  test('disconnecting the active destination is blocked until another destination is chosen', () => {
    // When Google Drive is active, disconnecting Google Drive is blocked
    expect(canDisconnect('gdrive', 'gdrive')).toBe(false);
    // Disconnecting another provider while Google Drive is active is allowed
    expect(canDisconnect('gdrive', 's3')).toBe(true);
    // When OpenDocs storage is active (null), disconnecting Google Drive is allowed
    expect(canDisconnect(null, 'gdrive')).toBe(true);
  });
});
