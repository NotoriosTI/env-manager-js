# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es/1.1.0/).
Este proyecto sigue versionado semántico.

## [0.3.1] — 2026-09-03

### Añadido

- `secrets set --allow-empty` permite almacenar intencionalmente una cadena
  vacía; sin el flag, stdin vacío sigue siendo un error.
- `fallbackToIndividual` en la API y `fallback_to_individual` en YAML permiten
  hacer autoritativo el secreto consolidado. El valor predeterminado compatible
  es `true`.
- Un resumen agregado por carga informa accesos al JSON, accesos individuales y
  claves ausentes sin exponer nombres ni valores.

### Corregido

- La rotación destruye versiones anteriores `ENABLED` y `DISABLED`, ya que
  ambos estados son facturables, e inicializa desde `{}` un recurso sin versiones.
- La corrección del warning preventivo de `GCP_PROJECT_ID` aplica sólo al
  runtime Python. JS no emite ese warning; mantiene el error explícito al crear
  un loader GCP sin project ID.

### Notas

- Las escrituras concurrentes al mismo secreto no están soportadas y deben
  serializarse externamente.
- `SECRET_ORIGIN`, `GCP_PROJECT_ID` y `CONSOLIDATED_SECRET` definidos en el
  entorno del proceso o `.env` prevalecen sobre el YAML.

## [0.3.0] — 2026-09-01

Versión alineada con el blueprint §1 de la base de conocimiento
(`conocimiento.notorios.cl/#/p/4b2b7217953e`) y con el runtime Python.

> **Trae tres cambios de conducta.** Léelos antes de actualizar: los tres
> pueden romper código que hoy funciona.

### Cambios de conducta

1. **`process.env` se escribe con el NOMBRE de la variable, no con su `source`.**
   Un config que declara `PGHOST` con `source: JUAN_DB_HOST` ahora exporta
   `PGHOST`, que es lo que libpq busca; antes exportaba `JUAN_DB_HOST` y
   `PGHOST` quedaba sin definir. Python siempre lo hizo así.

   Por **una versión** se sigue exportando también bajo el `source`, con un
   aviso por stderr. Ese alias se elimina en la siguiente release.

2. **`getConfig()` lanza si no hay singleton.** Antes devolvía `null`, que el
   consumidor no podía distinguir de "la variable no existe". Ahora acepta
   además un segundo argumento con el valor por defecto:
   `getConfig('KEY', 'fallback')`.

3. **`initConfig()` reemplaza la instancia.** Antes un segundo `initConfig()`
   con otro config era un no-op silencioso que devolvía la instancia vieja.

### Añadido

- **`consolidated_secret`** (§1.1): un solo secreto JSON por app en Secret
  Manager, leído una vez al arrancar, que precarga la caché. Se declara por
  entorno en el YAML, por la env var `CONSOLIDATED_SECRET` o por la opción
  `consolidatedSecret`. Las claves ausentes del payload caen a búsqueda
  individual, así que migrar no rompe nada.
- **CLI unificada `env-manager <acción>`** (§1.7). Un solo binario con el nombre
  de la aplicación y las acciones como subcomandos:

  ```
  env-manager encrypt <file> [--env NAME] [--force] [-o OUT] [--format text|json]
  env-manager decrypt <file> [--env NAME] [--key HEX] [-o OUT] [--format text|json]
  env-manager secrets list <secret> --project PROJECT
  env-manager secrets set  <secret> --key KEY --project PROJECT   # valor por stdin
  ```

- **`env-manager secrets set`** (§1.1): escribe una clave en el secreto JSON
  consolidado y **destruye la versión anterior**, que se sigue facturando
  mientras esté habilitada. Agrega la versión nueva, la lee de vuelta para
  verificarla y recién entonces destruye las viejas. Escribir el mismo valor no
  crea versión. El valor entra por stdin, nunca por `argv`.
- **Exit codes estables por categoría**: `0` éxito, `1` uso, `2` operación,
  `3` dependencia opcional faltante, `4` fallo remoto.
- **Timeout explícito en cada llamada a Secret Manager** (§1.5.3): 10 s por
  defecto, configurable por opción o por `ENV_MANAGER_GCP_TIMEOUT`, con tope de
  3 intentos y backoff.
- **Taxonomía de errores transitorio vs determinista** (§1.5.4) por código gRPC.
- `ConfigManager.require()` y `ConfigManager.values`, por paridad con Python.
- `PARITY.md`: contrato de paridad con env-manager, y
  `scripts/parity-check.sh`, el gate que lo verifica.
- Test de integración real contra Secret Manager, saltado por defecto y
  limitado a un proyecto descartable explícito
  (`RUN_REAL_GCP_TESTS=1 ENV_MANAGER_ITEST_PROJECT=<proyecto>`).
- CI: node 20 / 22 / 24.

### Obsoleto

- `env-manager-encrypt` y `env-manager-decrypt` siguen funcionando **una
  versión**: avisan por stderr y delegan en el dispatcher. Se eliminan en la
  siguiente.

### Corregido

- **La precarga del secreto consolidado se perdía con `getMany()`.** Guardaba
  un booleano en vez de la promesa, así que el primer `get()` arrancaba el
  fetch y los demás seguían de largo sin esperarlo, cayendo a una búsqueda
  individual por clave. Es decir, el ahorro de llamadas se perdía justo en el
  camino más usado. Lo destapó el test de integración contra Secret Manager
  real.
- **La librería escribía en stdout** (§1.7). El diagnóstico ahora va a stderr;
  stdout queda para los resultados.
- **Errores tragados** (§1.5.5): ya no quedan `catch {}` vacíos. Un `.env` que
  existe pero no se puede leer se avisa en vez de confundirse con uno ausente.
- El descubrimiento de la raíz del proyecto ya no cruza el límite del
  repositorio: se detiene en `.git`, como Python.
