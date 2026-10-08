'use client';

import { useState } from 'react';

interface S3ConnectFormProps {
  disabled: boolean;
  isPending?: boolean;
  onSubmit: (fields: {
    bucket: string;
    access_key_id: string;
    secret_access_key: string;
    endpoint?: string;
    region?: string;
    prefix?: string;
    path_style?: boolean;
  }) => void;
}

/** S3-compatible connect: endpoint, region, bucket, prefix and keys, matching routes/storage.ts's parseConnectBody. */
export function S3ConnectForm({ disabled, isPending, onSubmit }: S3ConnectFormProps) {
  const [bucket, setBucket] = useState('');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [region, setRegion] = useState('');
  const [prefix, setPrefix] = useState('');
  const [pathStyle, setPathStyle] = useState(false);

  const canSubmit = bucket.trim().length > 0 && accessKeyId.trim().length > 0 && secretAccessKey.trim().length > 0;

  function handleSubmit() {
    if (!canSubmit) return;
    onSubmit({
      bucket: bucket.trim(),
      access_key_id: accessKeyId.trim(),
      secret_access_key: secretAccessKey.trim(),
      endpoint: endpoint.trim() || undefined,
      region: region.trim() || undefined,
      prefix: prefix.trim() || undefined,
      path_style: pathStyle,
    });
  }

  return (
    <div className="stack" style={{ marginTop: '12px' }}>
      <div className="grid2">
        <div className="fld" style={{ marginTop: 0 }}>
          <label htmlFor="s3-endpoint">Endpoint</label>
          <input
            id="s3-endpoint"
            type="url"
            value={endpoint}
            onChange={(event) => setEndpoint(event.target.value)}
            placeholder="Leave empty for AWS"
            disabled={disabled}
            autoComplete="off"
            spellCheck="false"
          />
          <small>Leave blank for AWS S3; set for other S3-compatible providers.</small>
        </div>
        <div className="fld" style={{ marginTop: 0 }}>
          <label htmlFor="s3-region">Region</label>
          <input
            id="s3-region"
            type="text"
            value={region}
            onChange={(event) => setRegion(event.target.value)}
            placeholder="us-west-2"
            disabled={disabled}
            autoComplete="off"
            spellCheck="false"
          />
        </div>
        <div className="fld" style={{ marginTop: 0 }}>
          <label htmlFor="s3-bucket">Bucket</label>
          <input
            id="s3-bucket"
            type="text"
            value={bucket}
            onChange={(event) => setBucket(event.target.value)}
            placeholder="my-guides-bucket"
            disabled={disabled}
            autoComplete="off"
            spellCheck="false"
          />
        </div>
        <div className="fld" style={{ marginTop: 0 }}>
          <label htmlFor="s3-prefix">Folder prefix</label>
          <input
            id="s3-prefix"
            type="text"
            value={prefix}
            onChange={(event) => setPrefix(event.target.value)}
            placeholder="opendocs/"
            disabled={disabled}
            autoComplete="off"
            spellCheck="false"
          />
        </div>
        <div className="fld" style={{ marginTop: 0 }}>
          <label htmlFor="s3-access-key-id">Access key ID</label>
          <input
            id="s3-access-key-id"
            type="text"
            value={accessKeyId}
            onChange={(event) => setAccessKeyId(event.target.value)}
            disabled={disabled}
            autoComplete="off"
            spellCheck="false"
          />
        </div>
        <div className="fld" style={{ marginTop: 0 }}>
          <label htmlFor="s3-secret-access-key">Secret access key</label>
          <input
            id="s3-secret-access-key"
            type="password"
            value={secretAccessKey}
            onChange={(event) => setSecretAccessKey(event.target.value)}
            disabled={disabled}
            autoComplete="off"
            spellCheck="false"
          />
        </div>
      </div>
      <div>
        <label className="switch" htmlFor="s3-path-style">
          <input
            id="s3-path-style"
            type="checkbox"
            checked={pathStyle}
            onChange={(event) => setPathStyle(event.target.checked)}
            disabled={disabled}
          />
          <span>Use path-style URLs</span>
        </label>
        <small style={{ display: 'block', color: 'var(--a-muted)', fontSize: '12.5px', marginTop: '4px' }}>
          Needed by some S3-compatible services.
        </small>
      </div>
      <p className="sub">Not connected yet. Test the connection before saving.</p>
      <div className="adm-buttons">
        <button type="button" className="btn btn-primary" disabled={disabled || !canSubmit} onClick={handleSubmit}>
          {isPending ? 'Connecting...' : 'Connect S3-compatible storage'}
        </button>
      </div>
    </div>
  );
}
