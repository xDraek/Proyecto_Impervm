// Tutorial para los jugadores nuevos: un consejero que señala dónde pulsar y
// avanza solo cuando haces cada cosa. Se puede saltar, y no vuelve a salir.

const KEY = (uid) => `imperium.tutorial.${uid}`;

const STEPS = [
  {
    id: 'recursos',
    target: '#resources',
    text: '👋 Soy tu consejero. Arriba tienes tus <b>recursos</b>: tu isla los produce sin parar, también con el juego cerrado. Pasa el ratón (o el dedo) por uno para ver de dónde sale.',
    manual: true,
  },
  {
    id: 'edificio',
    target: '#sidebar [data-id="aserradero"]',
    text: 'Para crecer hay que construir. Pulsa el <b>aserradero</b> (en la lista o en la isla) para ver qué hace.',
    done: (hud) => hud.selected === 'aserradero' || hud.game.queue,
  },
  {
    id: 'mejorar',
    target: '#panel [data-action="upgrade"]',
    text: 'Aquí ves lo que cuesta y lo que tarda. Pulsa <b>Mejorar</b>: tus obreros se ponen a trabajar.',
    done: (hud) => !!hud.game.queue,
    when: (hud) => hud.selected && !hud.game.queue,
  },
  {
    id: 'misiones',
    target: '#quests-btn',
    text: 'Mientras tanto, mira las <b>misiones</b>: cada una te dice qué hacer y te da una recompensa al cumplirla.',
    done: (hud) => hud.modalKind === 'quests',
  },
  {
    id: 'mapa',
    target: '#view-btn',
    text: 'Tu isla no está sola. Pulsa <b>Mapa</b> (o la tecla M) para ver el archipiélago: islas que explorar, bárbaros, piratas y otros jugadores.',
    done: (hud) => hud.view === 'mapa',
  },
  {
    id: 'puerto',
    target: '#sidebar',
    text: 'Para salir al mar necesitas un <b>puerto</b> (con el ayuntamiento a nivel 2) y algún <b>bote explorador</b>. Pulsa una isla para ver qué sabes de ella y mandar tu flota.',
    manual: true,
  },
  {
    id: 'social',
    target: '#chat-btn',
    text: 'Aquí hablas con los demás jugadores. Únete a una <b>alianza</b> 🤝 para defenderos y atacar juntos. ¡Suerte, gobernante!',
    manual: true,
    last: true,
  },
];

export class Tutorial {
  constructor(hud) {
    this.hud = hud;
    this.game = hud.game;
    let saved = null;
    try {
      saved = localStorage.getItem(KEY(this.game.userId));
    } catch {
      // sin almacenamiento: sale una vez por sesión
    }
    // Solo para quien empieza (un imperio pequeño que nunca lo ha terminado)
    this.step = saved === 'done' ? -1 : Number(saved) || 0;
    if (saved == null && this.game.level('ayuntamiento') >= 3) this.step = -1;
    this.card = document.createElement('div');
    this.card.id = 'tutorial';
    this.card.hidden = true;
    this.ring = document.createElement('div');
    this.ring.id = 'tutorial-ring';
    this.ring.hidden = true;
    document.body.append(this.ring, this.card);
    this.card.addEventListener('click', (e) => {
      const action = e.target.closest('[data-tut]')?.dataset.tut;
      if (action === 'next') this.#advance();
      if (action === 'skip') this.#finish();
    });
    this.timer = setInterval(() => this.update(), 400);
    window.addEventListener('resize', () => this.update());
  }

  #save(value) {
    try {
      localStorage.setItem(KEY(this.game.userId), String(value));
    } catch {
      // sin almacenamiento
    }
  }

  #advance() {
    if (STEPS[this.step]?.last) return this.#finish();
    this.step++;
    this.#save(this.step);
    this.rendered = null;
    this.update();
  }

  #finish() {
    this.step = -1;
    this.#save('done');
    this.card.hidden = true;
    this.ring.hidden = true;
    clearInterval(this.timer);
  }

  update() {
    if (this.step < 0) return;
    const step = STEPS[this.step];
    if (!step) return this.#finish();
    // Los pasos automáticos se dan por hechos en cuanto el jugador lo hace
    if (step.done?.(this.hud)) return this.#advance();
    // No molestar con una ventana abierta (salvo que el paso sea abrirla) ni antes de la bienvenida
    const blocked = !this.hud.modal.hidden || (step.when && !step.when(this.hud));
    const target = document.querySelector(step.target);
    if (blocked || !target || !target.getClientRects().length) {
      this.card.hidden = true;
      this.ring.hidden = true;
      return;
    }
    if (this.rendered !== step.id) {
      this.rendered = step.id;
      this.card.innerHTML = `<div class="tut-text">${step.text}</div>
        <div class="tut-actions">
          <span class="muted small">${this.step + 1} / ${STEPS.length}</span>
          <button class="ghost small" data-tut="skip">Saltar</button>
          ${step.manual ? `<button class="primary small" data-tut="next">${step.last ? '¡A jugar!' : 'Entendido'}</button>` : ''}
        </div>`;
    }
    this.card.hidden = false;
    this.ring.hidden = false;
    // Anillo alrededor de lo que hay que pulsar y la tarjeta al lado (abajo en el móvil)
    const r = target.getBoundingClientRect();
    const pad = 4;
    Object.assign(this.ring.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    const card = this.card.getBoundingClientRect();
    const mobile = innerWidth <= 800;
    let left;
    let top;
    if (mobile) {
      left = (innerWidth - card.width) / 2;
      top = r.top + r.height / 2 > innerHeight / 2 ? Math.max(8, r.top - card.height - 14) : Math.min(innerHeight - card.height - 8, r.bottom + 14);
    } else {
      left = Math.min(innerWidth - card.width - 12, Math.max(12, r.left + r.width / 2 - card.width / 2));
      top = r.bottom + 14 + card.height < innerHeight ? r.bottom + 14 : Math.max(12, r.top - card.height - 14);
      if (r.width > innerWidth * 0.5 || r.height > innerHeight * 0.5) {
        // Objetivos grandes (barra lateral): la tarjeta va a su lado
        left = r.right + 14 + card.width < innerWidth ? r.right + 14 : Math.max(12, r.left - card.width - 14);
        top = Math.min(innerHeight - card.height - 12, Math.max(12, r.top + 40));
      }
    }
    this.card.style.left = `${Math.round(left)}px`;
    this.card.style.top = `${Math.round(top)}px`;
  }
}
