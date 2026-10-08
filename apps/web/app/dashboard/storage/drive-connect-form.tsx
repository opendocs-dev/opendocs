'use client';

import { useState } from 'react';

interface DriveConnectFormProps {
  disabled: boolean;
  isPending?: boolean;
  onSubmit: (fields: { folder_id: string; refresh_token: string }) => void;
}

/** Paste-based Drive connect: a refresh token and target folder id, not a hosted OAuth flow. */
export function DriveConnectForm({ disabled, isPending, onSubmit }: DriveConnectFormProps) {
  const [folderId, setFolderId] = useState('');
  const [refreshToken, setRefreshToken] = useState('');

  const canSubmit = folderId.trim().length > 0 && refreshToken.trim().length > 0;

  function handleSubmit() {
    if (!canSubmit) return;
    onSubmit({ folder_id: folderId.trim(), refresh_token: refreshToken.trim() });
  }

  return (
    <div className="stack" style={{ marginTop: '12px' }}>
      <div className="grid2">
        <div className="fld" style={{ marginTop: 0 }}>
          <label htmlFor="drive-folder-id">Folder ID</label>
          <input
            id="drive-folder-id"
            type="text"
            value={folderId}
            onChange={(event) => setFolderId(event.target.value)}
            placeholder="1Ab2CdEfGhIjKlMnOpQrStUvWxYz"
            disabled={disabled}
            autoComplete="off"
            spellCheck="false"
          />
          <small>The Google Drive folder your guide files should be stored in.</small>
        </div>
        <div className="fld" style={{ marginTop: 0 }}>
          <label htmlFor="drive-refresh-token">Refresh token</label>
          <input
            id="drive-refresh-token"
            type="password"
            value={refreshToken}
            onChange={(event) => setRefreshToken(event.target.value)}
            placeholder="OAuth refresh token"
            disabled={disabled}
            autoComplete="off"
            spellCheck="false"
          />
          <small>An OAuth refresh token for an account with access to that folder.</small>
        </div>
      </div>
      <div className="adm-buttons">
        <button type="button" className="btn btn-primary" disabled={disabled || !canSubmit} onClick={handleSubmit}>
          {isPending ? 'Connecting...' : 'Connect Google Drive'}
        </button>
      </div>
    </div>
  );
}
