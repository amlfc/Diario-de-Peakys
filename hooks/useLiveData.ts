
import { useState, useEffect } from 'react';
import { db } from '../db';

// Un hook simple que suscribe componentes a cambios en la "Base de Datos Virtual"
export function useLiveData<T>(querier: () => Promise<T>, deps: any[] = []): T {
  const [data, setData] = useState<T>([] as any);

  const fetchData = async () => {
    try {
      const result = await querier();
      setData(result);
    } catch (err) {
      console.error("useLiveData error", err);
    }
  };

  useEffect(() => {
    fetchData();

    // Suscribirse a cambios globales
    const unsubscribe = db.subscribe(fetchData);
    return () => unsubscribe();
  }, [...deps]);

  return data;
}
