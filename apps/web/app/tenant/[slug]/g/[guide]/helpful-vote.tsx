'use client';

import { useEffect, useState } from 'react';

type Props = {
  slug: string;
  guideSlug: string;
};

export function HelpfulVote({ slug, guideSlug }: Props) {
  const [voted, setVoted] = useState<'yes' | 'no' | null>(null);
  const [mounted, setMounted] = useState(false);

  const storageKey = `opendocs_vote_${guideSlug}`;

  useEffect(() => {
    setMounted(true);
    const existing = localStorage.getItem(storageKey);
    if (existing === 'yes' || existing === 'no') {
      setVoted(existing);
    }

    // Record view once when reader opens the guide in browser (C14-AC29)
    fetch(`/api/v1/site/${encodeURIComponent(slug)}/guides/${encodeURIComponent(guideSlug)}/view`, {
      method: 'POST',
    }).catch(() => {});
  }, [slug, guideSlug, storageKey]);

  const handleVote = async (helpful: boolean) => {
    if (voted !== null) return;
    const choice = helpful ? 'yes' : 'no';
    setVoted(choice);
    try {
      localStorage.setItem(storageKey, choice);
    } catch {
      // In private browsing mode or storage blocked, state still guards in-session
    }

    await fetch(
      `/api/v1/site/${encodeURIComponent(slug)}/guides/${encodeURIComponent(guideSlug)}/vote`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ helpful }),
      },
    ).catch(() => {});
  };

  return (
    <div className="fb">
      <span>Was this guide helpful?</span>
      {mounted && voted !== null ? (
        <span className="sub">Thank you for your feedback!</span>
      ) : (
        <span>
          <button
            type="button"
            className="btn"
            onClick={() => handleVote(true)}
            aria-label="Vote guide helpful: Yes"
          >
            Yes
          </button>{' '}
          <button
            type="button"
            className="btn"
            onClick={() => handleVote(false)}
            aria-label="Vote guide helpful: No"
          >
            No
          </button>
        </span>
      )}
    </div>
  );
}
