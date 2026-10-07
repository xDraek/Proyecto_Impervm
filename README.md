# Imperium

Juego de estrategia multijugador en el navegador, al estilo de Ikariam u OGame: cada jugador funda su ciudad en un archipiélago 3D compartido (hecho con [Three.js](https://threejs.org/)), la hace crecer, explora, comercia y ataca a otros jugadores. El servidor es el árbitro de todo y el mundo sigue vivo aunque nadie esté conectado.

## Arrancar en tu ordenador

```bash
npm install
npm run dev
```

Abre `http://localhost:5173`, crea una cuenta y a jugar. `npm run dev` arranca el servidor del juego con Vite dentro (recarga en caliente) y guarda el mundo en `server/data/world.json`. Para ver a otros jugadores, crea otra cuenta en otra ventana privada.

Para probar más rápido: `GAME_SPEED=50 npm run dev` (en PowerShell: `$env:GAME_SPEED=50; npm run dev`).

## Subirlo a la nube

El juego es un único servidor Node que sirve la página y la API, más una base de datos Postgres.

### Render (gratis)

1. Sube el repositorio a GitHub.
2. En [Render](https://render.com): **New → Blueprint** y elige el repositorio. El archivo `render.yaml` crea el servidor y una base de datos.
3. Cuando termine, abre la dirección que te da Render.

En el plan gratuito, el servidor se duerme tras 15 minutos sin visitas y tarda un poco en despertar; al hacerlo se pone al día con todo lo que pasó. La base de datos gratuita de Render caduca a los 30 días: para algo duradero, crea una gratis en [Neon](https://neon.tech) o [Supabase](https://supabase.com) y pon su dirección en la variable `DATABASE_URL`.

### Otras nubes

Hay un `Dockerfile` para cualquier servicio que acepte contenedores (Railway, Fly.io, un VPS…). Variables de entorno:

| Variable | Para qué |
| --- | --- |
| `DATABASE_URL` | Postgres donde se guarda el mundo. Sin ella se usa un archivo local (no sirve en la nube: se borra en cada despliegue). |
| `AUTH_SECRET` | Clave para firmar las sesiones. Pon una larga y aleatoria. |
| `GAME_SPEED` | Velocidad del universo (1 = normal). |
| `PORT` | Puerto (las nubes lo ponen solas). |

El servidor guarda el mundo en memoria y lo vuelca a la base de datos cada 10 segundos, así que debe haber **una sola instancia**.

## Cómo se juega

- Al crear la cuenta eliges tu nombre y el de tu ciudad. Cada jugador nuevo abre un **sector** del archipiélago: su isla en el centro y una docena de islas neutrales alrededor. Los sectores se colocan en espiral, así que tus vecinos son los que se registraron cerca de ti.
- Tu isla produce **madera, piedra, comida, hierro, cristal y oro** en tiempo real, también con la pestaña cerrada.
- **14 edificios**, entre ellos el templo y el **Coloso**, una maravilla de 10 niveles que es el gran objetivo final.
- **Academia** con 13 investigaciones, **cuartel y puerto** con 5 tropas y 4 barcos. Las tropas comen: sin comida hay hambruna.
- **Mapa compartido** (🗺️ o tecla `M`): campamentos bárbaros y fortalezas piratas que se rearman, ruinas con un tesoro para el primero que llegue, islas libres para **colonizar** (la primera flota que llega se la queda), el Kraken y el Mar de las Brumas para las **expediciones**.
- **Otros jugadores**: espía sus ciudades con botes exploradores y atácalas para llevarte sus recursos (salvo lo que esconde su almacén). Si alguien viene a por ti, lo verás llegar. Con menos de 100 puntos tienes **protección de novato**: nadie te ataca y tú no atacas a otros jugadores.
- **Alianzas** 🤝: fúndalas o únete a una (hasta 20 miembros). Los aliados no pueden atacarse, tienen su propio chat y una clasificación de alianzas.
- **Apoyo** 🛡️: manda tropas a defender la ciudad de un aliado. Se quedan allí y combaten junto a él hasta que las retires (y vuelven solas si dejáis de ser aliados).
- **Correo** ✉️: mensajes privados entre jugadores.
- **Perfiles y logros** 👤: cada jugador tiene un perfil con su puesto, su ciudad, su alianza y 15 logros que se ganan jugando.
- **Simulador de combate** 🎲: prueba un ataque antes de lanzarlo, con lo que sabes de la isla por tus espías.
- **Regalo diario** 🎁: un regalo cada día que entras; la racha de 7 días tiene premio gordo.
- **Transportes** 📦: manda recursos en barcos mercantes a la ciudad de cualquier jugador.
- **Mercado del archipiélago** ⚖️: publica ofertas («doy 500 de madera por 200 de cristal») y acepta las de otros. Lo ofrecido queda apartado hasta que alguien acepta o pasan 3 días.
- Avisos del navegador (opcional) cuando te atacan con la pestaña en segundo plano, y cambio de contraseña desde ⚙.
- **Piratas** de vez en cuando, **visitantes**, **poderes divinos**, **misiones** con recompensa, **chat** 💬 (global y de alianza) y **clasificación** 🏆 de jugadores y alianzas.

## Estructura

```
server/
  index.js             servidor HTTP: API, límites de peticiones, archivos del juego
  WorldServer.js       el mundo en memoria: jugadores, islas, ataques, alianzas, correo, mercado, chat
  store.js             guardado en Postgres (DATABASE_URL) o en un archivo local
  auth.js              contraseñas (scrypt) y sesiones firmadas
src/
  config.js            velocidad del universo y reloj compartido
  game/data.js         recursos, edificios, unidades, investigaciones, poderes, misiones
  game/rules.js        fórmulas: costes, tiempos, economía, viajes
  game/combat.js       combate por asaltos
  game/world.js        generación de sectores e islas
  game/Game.js         la partida de un jugador (árbitro en el servidor, espejo en el navegador)
  net/                 conexión con el servidor (ClientGame, ClientWorld, api)
  scene/               escena 3D: tu isla, el archipiélago, mar, barcos
  ui/                  pantalla principal, interfaz, paneles, informes, chat, alianza/correo/mercado (social.js)
```

En la consola del navegador, ya dentro de la partida, está `window.__IMPERIUM__` (`game`, `world`, `hud`, `select`, `setView`).

## Próximos pasos posibles

- Diplomacia entre alianzas (pactos y guerras) y foro de alianza.
- Varias ciudades por jugador (las colonias como ciudades completas).
- Recuperar la contraseña por correo.
