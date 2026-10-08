/** Absolute published-doc URL; strips a trailing slash from BETTER_AUTH_URL. */
export const docUrl = (flowPublicId: string) =>
  `${(process.env.BETTER_AUTH_URL ?? '').replace(/\/$/, '')}/d/${flowPublicId}`;
