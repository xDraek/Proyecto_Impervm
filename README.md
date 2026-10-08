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
| `ADMINS` | Nombres de los moderadores, separados por comas (pueden silenciar, suspender, borrar mensajes y hacer anuncios con `/anuncio texto` en el chat). |
| `PORT` | Puerto (las nubes lo ponen solas). |

El servidor guarda el mundo en memoria y lo vuelca a la base de datos cada 10 segundos, así que debe haber **una sola instancia**.

## Cómo se juega

- Al crear la cuenta eliges tu nombre y el de tu ciudad. Cada jugador nuevo abre un **sector** del archipiélago: su isla en el centro y una docena de islas neutrales alrededor. Los sectores se colocan en espiral, así que tus vecinos son los que se registraron cerca de ti.
- Tu isla produce **madera, piedra, comida, hierro, cristal y oro** en tiempo real, también con la pestaña cerrada.
- **19 edificios**, entre ellos el templo, la taberna (las tropas comen menos), la forja (más ataque), la torre de vigía, el faro (flotas más rápidas), el astillero y el **Coloso**, una maravilla de 10 niveles que es el gran objetivo final.
- **Academia** con 13 investigaciones, **cuartel y puerto** con 7 tropas (honderos, hoplitas…) y 6 barcos (brulotes, dromones…). Las tropas comen: sin comida hay hambruna.
- **Continentes** 🗺️: entre cada tres sectores puede haber un pequeño continente con ciudades bárbaras amuralladas (mucho botín) y valles fértiles que colonizar. Las ciudades bárbaras se pueden **conquistar** 🏴: si tu ejército acaba con toda la guarnición, los colonos se quedan con ella y pasa a ser tuya.
- **Maravillas** 🏛️: cada continente tiene una (Templo de Poseidón, Forja de Hefesto, Jardines de Deméter o Biblioteca de Atenea). La levantan entre todos los que tienen colonia allí aportando madera, piedra y cristal; con cada uno de sus 5 niveles todos ellos ganan más velocidad de flota, ataque, comida o investigación.
- **Reliquias** 🏺: diez objetos míticos (de raros a legendarios) que se encuentran en expediciones, ruinas, conquistas y en la guarida del Kraken. Se equipan hasta tres desde el ayuntamiento o se venden por oro.
- **Cuenta segura**: al crearla recibes un código de recuperación; con tu nombre y ese código puedes poner otra contraseña desde la pantalla de inicio. Los moderadores pueden dar una contraseña temporal.
- **Encargos diarios** 📜: cada día tres tareas distintas (invertir, entrenar, saquear, explorar, comerciar…) con recompensa, y premio extra por cumplir las tres.
- **Competición semanal** 🏅: cada semana se premia a los tres mejores en saqueo, militar y construcción (solo cuenta lo hecho esa semana). Los ganadores quedan en el salón de la fama, en la pestaña «Semana» de la clasificación.
- **Efectos de combate**: humo, fuego y destellos en la isla donde se libra una batalla (también en tu muralla cuando te atacan).
- **Guía del juego** 📖 (desde ⚙ o con la tecla `?`): todos los sistemas explicados, con buscador.
- **Música ambiental** 🎵: una lira que improvisa sobre una escala pentatónica, generada en el navegador (se apaga desde ⚙).
- **Tutorial**: un consejero guía a los jugadores nuevos por sus primeros pasos (se puede saltar).
- **Clima**: cada media hora puede estar despejado, nublado, lloviendo o haber tormenta con relámpagos y truenos (igual para todos). Alrededor de tu isla faenan pesqueros, saltan delfines y los carros de bueyes suben por la avenida.
- Tu ciudad crece a la vista: barrios que se llenan de casas con el ayuntamiento, campos, ovejas, farolas que se encienden de noche y una playa con barcas y cabañas.
- **Mapa compartido** (🗺️ o tecla `M`): campamentos bárbaros y fortalezas piratas que se rearman, ruinas con un tesoro para el primero que llegue, islas libres para **colonizar** (la primera flota que llega se la queda), el Kraken y el Mar de las Brumas para las **expediciones**.
- **Otros jugadores**: espía sus ciudades con botes exploradores y atácalas para llevarte sus recursos (salvo lo que esconde su almacén). Si alguien viene a por ti, lo verás llegar. Con menos de 100 puntos tienes **protección de novato**: nadie te ataca y tú no atacas a otros jugadores.
- **Alianzas** 🤝: fúndalas o pide entrar en una (hasta 20 miembros); el líder y sus oficiales aceptan las solicitudes, o la alianza puede ser abierta. Rangos de líder 👑 y oficial ⭐, y el mando se puede ceder. Los aliados no pueden atacarse, tienen su propio chat, circulares para todos los miembros y una clasificación de alianzas.
- **Diplomacia** 🕊️⚔️: quien lidera una alianza puede proponer **pactos de no agresión** (mientras duren, no os podéis atacar) o **declarar la guerra**. En guerra los barcos cargan un 20 % más de botín al saquear al enemigo y se lleva el marcador de bajas y botín de cada bando hasta que se firma la paz.
- **Eventos del archipiélago** 📅: cada 6 horas puede empezar una temporada para todos (Fiebre del oro, Festival de Poseidón, Gran feria, Vientos de bonanza…). Se anuncian en el chat y el calendario (botón de la barra superior) enseña las próximas.
- **Colonias mejorables** 🚩: amplía cada colonia hasta el nivel 10; cada nivel produce un 60 % más de lo que daba al fundarla.
- **Foro de la alianza** 🗂️: temas con respuestas para organizarse; quien lidera puede fijarlos y el botón de la alianza avisa de lo que no has leído.
- **Modo vacaciones** 🏖️ (desde ⚙): mientras estás fuera nadie te ataca ni te espía y no llegan piratas, pero tu isla tampoco produce ni puedes jugar. Dura al menos 48 horas.
- **Jugadores inactivos** 💤: quien lleva una semana sin entrar aparece marcado en el mapa (y es un buen objetivo).
- **Mapa del mundo** 🌍: todo el archipiélago en un mapa que se arrastra y se acerca, con las ciudades coloreadas según vuestra relación (aliados, pactos, enemigos), buscador de jugadores y distancia en tiempo de viaje.
- **Almirante** 🎖️: un héroe que contratas en el ayuntamiento. Acompaña a una flota (más ataque, carga o velocidad) o defiende la isla; sube de nivel con los combates y repartes sus puntos. Si su flota cae, vuelve herido.
- **Contraespionaje**: la muralla puede descubrir y hundir los botes espía (8 % por nivel).
- **Todo en vivo**: el servidor empuja por WebSocket los ataques que se acercan, los cambios de tu ciudad y los mensajes del chat al momento.
- **Ataques conjuntos** 🤝: cuando un aliado ataca otra ciudad, puedes sumar tu flota (si llega a tiempo) para que combatáis como un solo ejército. Hasta 5 flotas; las bajas y el botín se reparten entre todos.
- **Repeticiones de combate** ▶: en los informes puedes ver la batalla asalto a asalto.
- **Apoyo** 🛡️: manda tropas a defender la ciudad de un aliado. Se quedan allí y combaten junto a él hasta que las retires (y vuelven solas si dejáis de ser aliados).
- **Correo** ✉️: mensajes privados entre jugadores.
- **Perfiles y logros** 👤: cada jugador tiene un perfil con su puesto, su ciudad, su alianza y 15 logros que se ganan jugando.
- **Simulador de combate** 🎲: prueba un ataque antes de lanzarlo, con lo que sabes de la isla por tus espías.
- **Regalo diario** 🎁: un regalo cada día que entras; la racha de 7 días tiene premio gordo.
- **Transportes** 📦: manda recursos en barcos mercantes a la ciudad de cualquier jugador.
- **Mercado del archipiélago** ⚖️: publica ofertas («doy 500 de madera por 200 de cristal») y acepta las de otros. Lo ofrecido queda apartado hasta que alguien acepta o pasan 3 días.
- Avisos del navegador (opcional) cuando te atacan con la pestaña en segundo plano, y cambio de contraseña desde ⚙.
- **Piratas** de vez en cuando, **visitantes**, **poderes divinos**, **misiones** con recompensa, **chat** 💬 (global y de alianza) y **clasificación** 🏆 de imperios, militar (bajas enemigas), saqueo y alianzas.

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
  ui/                  pantalla principal, interfaz, paneles, informes, chat, alianza/correo/mercado (social.js), mapa del mundo (worldMap.js)
```

En la consola del navegador, ya dentro de la partida, está `window.__IMPERIUM__` (`game`, `world`, `hud`, `select`, `setView`).

## Próximos pasos posibles

- Varias ciudades por jugador (las colonias como ciudades completas).
- Recuperar la contraseña por correo.
