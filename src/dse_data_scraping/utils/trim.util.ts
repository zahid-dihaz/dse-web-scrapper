// Recursively trims leading/trailing whitespace from every string value in
// an object/array (including nested JSON fields like eps_share), so scraped
// data is normalized once, right before it's persisted.
export function trimDeep<T>(value: T): T {
  if (typeof value === 'string') {
    return value.trim() as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => trimDeep(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      result[key] = trimDeep((value as Record<string, unknown>)[key]);
    }
    return result as T;
  }
  return value;
}
