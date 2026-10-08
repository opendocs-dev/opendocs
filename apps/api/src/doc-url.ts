import { getEnv } from './env';

/** Absolute published-doc URL on this instance. */
export const docUrl = (flowPublicId: string) => `${getEnv().publicUrl}/d/${flowPublicId}`;
