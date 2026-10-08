const SLUG_MIN_LENGTH = 3;
const SLUG_MAX_LENGTH = 30;

/** Starts and ends with a letter/digit; hyphens allowed in between, never doubled. */
const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export type SlugValidation = { ok: true; slug: string } | { ok: false; reason: string };

/** Lowercases first, so casing alone never changes the result. */
export const validateSlug = (input: string): SlugValidation => {
  const slug = input.toLowerCase();

  if (slug.length < SLUG_MIN_LENGTH || slug.length > SLUG_MAX_LENGTH) {
    return { ok: false, reason: `Address must be ${SLUG_MIN_LENGTH}-${SLUG_MAX_LENGTH} characters` };
  }
  if (!SLUG_PATTERN.test(slug)) {
    return {
      ok: false,
      reason: 'Address must use lowercase letters, numbers and hyphens, and start/end with a letter or number',
    };
  }
  if (slug.includes('--')) {
    return { ok: false, reason: 'Address cannot contain repeated hyphens' };
  }

  return { ok: true, slug };
};
