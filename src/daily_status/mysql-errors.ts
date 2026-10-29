// Without a connection pool, MySQL connection loss has to be recognised from
// the error codes mysql2 raises on connect and on query.

const CONNECTION_LOST_CODES = new Set([
  'PROTOCOL_CONNECTION_LOST',
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ER_CON_COUNT_ERROR',
  'EHOSTUNREACH',
  'ENOTFOUND',
  'EPIPE',
]);

export interface ClassifiedError {
  label: string;
  detail: string;
}

export function classifyMysqlError(
  err: unknown,
  phase: 'connect' | 'query' = 'query',
): ClassifiedError {
  const e = err as { code?: string; name?: string; message?: string };
  const code = e?.code ?? '';
  const timedOut = /timed? ?out/i.test(e?.message ?? '');
  if (CONNECTION_LOST_CODES.has(code) || (!code && timedOut)) {
    return { label: 'MySQL connection lost', detail: code || 'timeout' };
  }
  return {
    label: phase === 'connect' ? 'MySQL connect failed' : 'MySQL query failed',
    detail: code || e?.name || 'unknown',
  };
}
