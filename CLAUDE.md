# Imperium

Juego de estrategia multijugador en el navegador al estilo de Ikariam/OGame: un archipiélago low-poly en 3D (Three.js + Vite) compartido por todos los jugadores. Hay un servidor Node (`server/`) que guarda las cuentas y el mundo (Postgres si hay `DATABASE_URL`, si no un archivo en `server/data/`).

- El usuario escribe en español. Responde, comenta el código y escribe los textos del juego en español.
- Estructura: las reglas puras van en `src/game/` (sin Three.js ni DOM): las usan tanto el servidor como el navegador. La escena 3D va en `src/scene/`, la interfaz en `src/ui/` y la conexión con el servidor en `src/net/`.
- `Game` es la partida de un jugador. En el servidor (`mode: 'server'`) decide todo: `#advance` procesa en orden cronológico los sucesos (obras, investigaciones, reclutas, flotas, piratas, visitantes, fin de poderes) y acumula la producción entre uno y otro. En el navegador (`ClientGame`, `mode: 'mirror'`) solo deja correr la producción y pide el estado nuevo al servidor cuando toca un suceso. Las acciones del jugador siempre las ejecuta el servidor.
- No metas lógica de juego que dependa de los fotogramas ni de `Date.now()`: usa `clock.now()` de `src/config.js` (en el navegador se corrige con la hora del servidor). Si añades algo con fecha, dale su suceso en `#nextEvent`.
- `Game` accede al mundo compartido a través de `world` (`WorldServer` en el servidor, `ClientWorld` en el navegador): islas, su estado compartido, información de otros jugadores y, en el servidor, ataques y espionaje entre jugadores.
- Cada acción nueva sobre la partida hay que añadirla a `ACTIONS` en `server/index.js` validando sus argumentos (nunca se pasan tal cual: el último parámetro de casi todos los métodos es la hora) y a `ClientGame`.
- Conexión en vivo: `WorldServer` escucha el evento `change` de cada partida y, tras cada vuelta del bucle, `flushPush` manda el estado nuevo por WebSocket (`/ws`, `src/net/socket.js`). El chat también se empuja. La consulta periódica del cliente queda como respaldo.
- Eventos del archipiélago: `worldEventAt(t)` (`rules.js`) los saca de `universe.eventSeed` (en `meta.eventSeed`, viaja en el estado), así que servidor y navegador calculan el mismo calendario. El cambio de tramo es un suceso de `#nextEvent` porque cambia la producción; `economy`, `favorRate` y `tradeRate` reciben el instante.
- Modo vacaciones: `state.vacation` congela `#accrue` y salta piratas y visitantes en `#nextEvent`; `server/index.js` solo deja hacer las acciones de `VACATION_OK`. La última visita se guarda en `state.lastSeen` (`WorldServer.seen`) y marca a los inactivos.
- Moderadores: variable `ADMINS`; la moderación vive en `meta.mod` y las rutas `/api/admin/…`.
- Lo social (alianzas, correo, mercado entre jugadores) vive en `WorldServer` con sus propias rutas (`/api/alliance…`, `/api/mail…`, `/api/market…`) y en el cliente en `src/ui/social.js`. Alianzas, diplomacia (`meta.diplomacy`, clave `idMenor-idMayor` → pacto, guerra con su marcador o propuesta pendiente) y ofertas se guardan en `meta`; `WorldServer.relation(a, b)` da 'aliado', 'pacto', 'guerra' o null, y llega al navegador como `rel` de cada jugador del estado (`ClientWorld.relation`). El foro de cada alianza va en `meta.forums[idAlianza]` (rutas `/api/forum…`); lo leído, en `state.forumSeen` de cada jugador. El mapa del mundo (`GET /api/map`, `src/ui/worldMap.js`) va en una caché de 30 s; el correo, en el estado de cada jugador (`state.mail`, que no viaja en el estado normal: solo el número sin leer).
- Los datos (edificios, unidades, investigaciones, poderes, misiones) viven en `src/game/data.js`; las islas se generan por sectores en `src/game/world.js`. Los requisitos (`requires`) mezclan edificios e investigaciones, así que sus ids no se pueden repetir.
- La interfaz solo regenera el HTML de un panel cuando cambia (evento `change`); lo que corre con el reloj se refresca en el sitio con atributos `data-until`, `data-bar`, `data-cost`, `data-need` y `data-wait` (ver `Hud#refreshLive`). Escapa con `escapeHtml` todo texto que venga de jugadores (nombres, ciudades, chat).
- Las partidas guardadas llevan versión (`SAVE_VERSION`); `upgradeState` completa las antiguas con los campos nuevos.

## Probar

- Servidor de desarrollo: configuración `imperium` en `.claude/launch.json` (`npm run dev`, puerto 5173). Es el servidor del juego con Vite dentro.
- `GAME_SPEED=N` acelera el universo. `DATA_FILE=ruta` usa otro archivo de mundo, útil para probar sin tocar el de desarrollo.
- Para probar varios jugadores, registra cuentas por la API (`POST /api/register`) o en ventanas privadas. Para una partida avanzada, prepara `server/data/world.json` con un script que use `WorldServer` + `FileStore` (cambiando edificios y recursos) antes de arrancar, y entra poniendo en `localStorage['imperium.token']` el token de `signToken`. Borra ese archivo al acabar.
- Las reglas se pueden probar sin navegador importando `server/WorldServer.js` con un almacén falso.
