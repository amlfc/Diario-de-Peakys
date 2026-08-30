# Historico para rentabilidad mensual

La aplicacion lee una pestana publicada de Google Sheets con cuatro columnas:

```csv
date,type,symbol,valueEur
2025-12-31,ASSET,AAPL,239.15
2025-12-31,ASSET,VWRL,129.42
2025-12-31,FX,USD,0.9654
2026-01-31,ASSET,AAPL,228.76
2026-01-31,FX,USD,0.9612
```

## Significado

- `date`: fecha real del cierre en formato `YYYY-MM-DD`.
- `type`: `ASSET` para activos o `FX` para divisas.
- `symbol`: ticker usado en Diario de Peakys o codigo ISO de la divisa.
- `valueEur`: precio unitario del activo en EUR o valor en EUR de una unidad de la divisa.

Los simbolos deben coincidir exactamente con los tickers de las transacciones. No hace falta incluir `FX,EUR,1`, porque la aplicacion considera EUR igual a 1.

## Preparacion en Google Sheets

1. Usa una pestana auxiliar con `GOOGLEFINANCE` para obtener los cierres de cada activo y los cambios de divisa.
2. Convierte cada precio a EUR en la propia hoja.
3. Copia los resultados y pegalos como valores en una pestana con el formato anterior.
4. Publica esa pestana como CSV o copia su URL incluyendo el parametro `gid`.
5. Pega la URL en `Configuracion > Fuente de Datos (Google Sheets) > Historico para rentabilidad mensual`.

Se necesita el ultimo cierre del ano anterior y cada cierre mensual posterior. La app acepta el ultimo dato disponible anterior al fin de mes con una antiguedad maxima de siete dias. Para calcular el ultimo mes completo durante enero tambien se necesita el cierre de noviembre del ano anterior.

Google no permite descargar automaticamente los resultados historicos dinamicos de `GOOGLEFINANCE`; por eso la pestana consumida por la app debe contener valores fijados.
