/**
 * Turn a DRF failure into one readable sentence.
 *
 * The backend's exception handler returns `{success: false, error: "..."}` for
 * business rules and `{field: ["..."]}` for serializer validation. Both shapes
 * are surfaced verbatim so the UI never invents a success or a reason.
 */
function flatten(value: any, depth = 0): string {
  if (depth > 3 || value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map((item) => flatten(item, depth + 1)).filter(Boolean).join(' ');
  if (typeof value === 'object') {
    const parts: string[] = [];
    Object.entries(value).forEach(([field, nested]) => {
      if (field === 'success') return;
      const text = flatten(nested, depth + 1);
      if (!text) return;
      parts.push(field === 'non_field_errors' ? text : `${field}: ${text}`);
    });
    return parts.join(' · ');
  }
  return '';
}

export function formatApiError(error: any, fallback: string): string {
  const data = error?.response?.data;

  if (typeof data === 'string' && data.trim()) return data;
  if (typeof data?.detail === 'string') return data.detail;
  if (typeof data?.error === 'string') return data.error;

  if (data && typeof data === 'object') {
    // The project-wide handler nests DRF field errors under `error`, e.g.
    // {success: false, error: {status: ["..."]}}. Flatten that payload without
    // the misleading "error:" prefix.
    const nested = (data as any).error;
    if (nested && typeof nested === 'object') {
      const nestedText = flatten(nested);
      if (nestedText) return nestedText;
    }
    const text = flatten(data);
    if (text) return text;
  }

  if (error?.code === 'ERR_NETWORK') {
    return 'The GreenPath server could not be reached. Check that the backend is running.';
  }

  return error?.message || fallback;
}

export const isForbidden = (error: any): boolean =>
  error?.response?.status === 403 || error?.response?.status === 401;
