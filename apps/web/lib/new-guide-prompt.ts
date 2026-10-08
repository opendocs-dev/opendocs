/**
 * Builds a guide prompt for the agent.
 * Returns a multi-line prompt with instructions for recording a guide.
 */
export function buildGuidePrompt({
  task,
  category,
  startUrl,
  review,
  publish,
}: {
  task: string;
  category?: string;
  startUrl?: string;
  review?: boolean;
  publish?: boolean;
}): string {
  const lines: string[] = [];

  // Line 1: Task
  const trimmedTask = (task || '').trim();
  lines.push(`Use OpenDocs to record how to: ${trimmedTask || '<describe the task>'}.`);

  // Start URL
  const trimmedUrl = (startUrl || '').trim();
  if (trimmedUrl) {
    lines.push(`Start at ${trimmedUrl}.`);
  }

  // Category
  const trimmedCategory = (category || '').trim();
  if (trimmedCategory) {
    lines.push(`File it under the category "${trimmedCategory}".`);
  } else {
    lines.push('Call opendocs_categories first and reuse a matching category name.');
  }

  // Finish
  lines.push('Finish with opendocs_compile.');

  // Review note
  // publish toggle ON (true) means publish immediately without review.
  // publish toggle OFF (false) or review=true keeps it as a draft for review.
  const shouldReview = publish !== undefined ? !publish : Boolean(review);
  if (shouldReview) {
    lines.push('Do not share the link: I will review it before it goes out.');
  }

  return lines.join('\n');
}
