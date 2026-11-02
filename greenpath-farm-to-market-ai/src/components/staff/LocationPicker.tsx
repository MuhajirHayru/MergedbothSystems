import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../services/apiClient';
import { formatApiError } from '../../lib/apiErrors';
import { ChevronRight, Loader2, MapPin } from 'lucide-react';

export interface AdministrativeLocation {
  id: string;
  name: string;
  level: string;
  level_display: string;
  has_children: boolean;
}

interface Props {
  /** Currently selected location id (deepest level selected). */
  value: string | null;
  onChange: (location: AdministrativeLocation | null) => void;
  /** Reports the whole region → zone → wereda path, not only the deepest row. */
  onPathChange?: (path: AdministrativeLocation[]) => void;
  /**
   * When set, the first column lists that location's children instead of the
   * nationwide roots — used to keep a scoped administrator inside their scope.
   */
  startParentId?: string | null;
  /** Label of the fixed parent scope shown above the selectors. */
  scopeLabel?: string;
  allowClear?: boolean;
  disabled?: boolean;
  label?: string;
  /** Keep the first column to one administrative level (e.g. REGION). */
  rootLevel?: string;
}

/**
 * Region → Zone → Wereda → … selector driven by
 * `GET /api/v1/registration/locations/?parent_id=…`, the backend's
 * administrative reference data (no hardcoded geography).
 */
export const LocationPicker: React.FC<Props> = ({
  value,
  onChange,
  onPathChange,
  startParentId = null,
  scopeLabel = '',
  allowClear = false,
  disabled = false,
  label = 'Administrative scope',
  rootLevel,
}) => {
  const [columns, setColumns] = useState<AdministrativeLocation[][]>([]);
  const [path, setPath] = useState<AdministrativeLocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadChildren = useCallback(async (parentId: string | null) => {
    const response = await api.registration.locations(parentId ? { parent_id: parentId } : undefined);
    const rows = Array.isArray(response?.data) ? (response.data as AdministrativeLocation[]) : [];
    return rows.filter((row) => row.id);
  }, []);

  // First column.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setColumns([]);
    setPath([]);
    loadChildren(startParentId)
      .then((rows) => {
        if (cancelled) return;
        const roots = rootLevel
          ? rows.filter((row) => row.level === rootLevel)
          : rows;
        setColumns([roots]);
      })
      .catch((err) => {
        if (!cancelled) setError(formatApiError(err, 'Unable to load administrative locations.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [startParentId, loadChildren, rootLevel]);

  // Keep only the columns that correspond to the current selected path.
  useEffect(() => {
    if (!value) {
      setPath([]);
    }
  }, [value]);

  const selectAt = async (depth: number, locationId: string) => {
    if (disabled) return;
    const column = columns[depth] || [];
    const chosen = column.find((row) => row.id === locationId) || null;
    setError('');

    if (!chosen) {
      const nextPath = path.slice(0, depth);
      setPath(nextPath);
      setColumns(columns.slice(0, depth + 1));
      onChange(nextPath[nextPath.length - 1] || null);
      onPathChange?.(nextPath);
      return;
    }

    const nextPath = [...path.slice(0, depth), chosen];
    setPath(nextPath);
    setColumns(columns.slice(0, depth + 1));
    onChange(chosen);
    onPathChange?.(nextPath);

    if (chosen.has_children) {
      setLoading(true);
      try {
        const children = await loadChildren(chosen.id);
        if (children.length) setColumns((current) => [...current.slice(0, depth + 1), children]);
      } catch (err) {
        setError(formatApiError(err, 'Unable to load child locations.'));
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5 text-[#15803D] dark:text-emerald-400" />
          {label}
        </span>
        {allowClear && value && (
          <button
            type="button"
            onClick={() => {
              setPath([]);
              setColumns(columns.slice(0, 1));
              onChange(null);
              onPathChange?.([]);
            }}
            className="text-[10px] font-semibold text-slate-500 hover:text-[#15803D] dark:text-slate-400"
          >
            Clear
          </button>
        )}
      </div>

      {scopeLabel && (
        <div className="text-[10px] text-slate-500 dark:text-slate-400">
          Assigned scope: <span className="font-semibold">{scopeLabel}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {columns.map((column, depth) => {
          const selected = path[depth]?.id || '';
          const levelLabel =
            column[0]?.level_display || (depth === 0 && startParentId ? 'Administrative unit' : 'Select');
          return (
            <React.Fragment key={`column-${depth}-${column[0]?.level || 'root'}`}>
              {depth > 0 && <ChevronRight className="w-3 h-3 text-slate-300 dark:text-slate-600 shrink-0" />}
              <select
                value={selected}
                onChange={(event) => void selectAt(depth, event.target.value)}
                disabled={disabled}
                aria-label={levelLabel}
                className="min-w-[132px] max-w-[190px] px-2 py-1.5 text-[11px] rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#15803D] disabled:opacity-60"
              >
                <option value="">{levelLabel}</option>
                {column.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </React.Fragment>
          );
        })}
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
      </div>

      {path.length > 0 && (
        <p className="text-[10px] text-emerald-700 dark:text-emerald-400 font-medium">
          {path.map((row) => row.name).join(' → ')}
        </p>
      )}
      {error && <p className="text-[10px] text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
};

export default LocationPicker;
