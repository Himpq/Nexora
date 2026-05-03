import { useCallback, useState } from "react";

export function useAsyncTask<TArgs extends unknown[], TResult>(
  task: (...args: TArgs) => Promise<TResult>,
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const run = useCallback(
    async (...args: TArgs) => {
      setLoading(true);
      setError(null);
      try {
        return await task(...args);
      } catch (err) {
        const normalized = err instanceof Error ? err : new Error(String(err));
        setError(normalized);
        throw normalized;
      } finally {
        setLoading(false);
      }
    },
    [task],
  );

  return { run, loading, error };
}
