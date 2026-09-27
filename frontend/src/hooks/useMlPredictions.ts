import { useEffect, useState } from 'react';
import { fetchMlPredictions, type MlPrediction } from '../services/api';

/**
 * All scored model predictions, fetched once and shared. Degrades quietly
 * to an empty map when predictions were never loaded into the database
 * (ml_poc/predict.py --to-db not run yet).
 */
export const useMlPredictions = () => {
  const [byCode, setByCode] = useState<Map<string, MlPrediction>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchMlPredictions().then((rows) => {
      if (!cancelled) {
        setByCode(new Map(rows.map((r) => [r.event_code, r])));
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { byCode, loading };
};
