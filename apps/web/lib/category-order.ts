/**
 * Moves a category up or down in the list.
 * Returns a new array; moving the first item up or the last item down, or an unknown id, returns the same order.
 */
export function moveCategory(ids: string[], id: string, dir: 'up' | 'down'): string[] {
  const index = ids.indexOf(id);
  if (index === -1) return ids;

  if (dir === 'up' && index === 0) return ids;
  if (dir === 'down' && index === ids.length - 1) return ids;

  const newIds = [...ids];
  const swapIndex = dir === 'up' ? index - 1 : index + 1;
  [newIds[index], newIds[swapIndex]] = [newIds[swapIndex], newIds[index]];
  return newIds;
}

/**
 * Returns position metadata for each category id.
 * Position = index in the array.
 */
export function positionsFor(ids: string[]): { id: string; position: number }[] {
  return ids.map((id, position) => ({ id, position }));
}

/**
 * Validates a category name.
 * Returns null if valid; otherwise returns an error message.
 */
export function validateCategoryName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return 'Enter a name';
  }
  if (trimmed.length > 40) {
    return 'Use 40 characters or fewer';
  }
  if (!/[a-zA-Z0-9]/.test(trimmed)) {
    return 'Use at least one letter or number';
  }
  return null;
}
