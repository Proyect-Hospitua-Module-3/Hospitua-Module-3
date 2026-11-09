// Feature 009 · Modificar precio tarifa según temporada
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../api/http';
import { getSeasonRules, SeasonCatalog, SeasonRule } from '../../api/seasonRules';
import { useAuth } from '../../auth/AuthContext';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; catalog: SeasonCatalog }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string };

function sortSeasons(seasons: SeasonRule[]): SeasonRule[] {
  return [...seasons].sort(
    (a, b) =>
      a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }) ||
      a.seasonId.localeCompare(b.seasonId),
  );
}

// Carga y mantiene el catálogo. El formulario conserva su propio borrador mientras
// el servidor valida una modificación o rechaza una versión desactualizada.
export function useSeasonRules() {
  const { session, logout } = useAuth();
  const token = session?.token ?? '';
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    setLoad({ kind: 'loading' });
    void getSeasonRules(token).then(
      (catalog) => {
        if (active) setLoad({ kind: 'ready', catalog });
      },
      (error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) return logout();
        if (error instanceof ApiError && error.status === 403) {
          setLoad({ kind: 'forbidden' });
          return;
        }
        setLoad({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Error desconocido.',
        });
      },
    );
    return () => {
      active = false;
    };
  }, [token, logout]);

  // Los errores de una recarga se presentan en la pantalla sin perder el borrador.
  const reload = useCallback(async () => {
    const catalog = await getSeasonRules(token);
    setLoad({ kind: 'ready', catalog });
    return catalog;
  }, [token]);

  function upsert(season: SeasonRule) {
    setLoad((current) =>
      current.kind !== 'ready'
        ? current
        : {
            kind: 'ready',
            catalog: {
              ...current.catalog,
              seasons: sortSeasons([
                ...current.catalog.seasons.filter((entry) => entry.seasonId !== season.seasonId),
                season,
              ]),
            },
          },
    );
  }

  function remove(seasonId: string) {
    setLoad((current) =>
      current.kind !== 'ready'
        ? current
        : {
            kind: 'ready',
            catalog: {
              ...current.catalog,
              seasons: current.catalog.seasons.filter((season) => season.seasonId !== seasonId),
            },
          },
    );
  }

  return { load, reload, upsert, remove };
}
