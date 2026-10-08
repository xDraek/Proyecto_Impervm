import { api, setToken } from '../net/api.js';
import { escapeHtml, fmtNum } from './format.js';

// Pantalla principal: presentación del juego, entrar o crear una cuenta (con el correo
// verificado), pedir otra contraseña y añadir el correo a las cuentas de antes.

const $ = (sel) => document.querySelector(sel);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const MODES = {
  login: { submit: 'Entrar', tabs: true },
  register: { submit: 'Crear la cuenta', tabs: true, note: 'Te mandaremos un correo para confirmar la cuenta. Tu ciudad se funda al abrir el enlace.' },
  forgot: { submit: 'Mandarme un enlace', note: 'Escribe el correo de tu cuenta y te mandaremos un enlace para poner otra contraseña.' },
  reset: { submit: 'Guardar la contraseña', note: 'Elige tu contraseña nueva.' },
  email: { submit: 'Confirmar mi correo', note: 'Ahora cada cuenta necesita un correo, para poder recuperarla si olvidas la contraseña. Añade el tuyo y confírmalo para seguir jugando.' },
};

/**
 * @param {{ onLogin: () => void, message?: string, mode?: string, resetToken?: string }} opts
 *   mode: con qué empieza (por ejemplo 'reset' al abrir el enlace de una contraseña nueva)
 */
export function showLanding({ onLogin, message, mode: firstMode = 'login', resetToken = null }) {
  document.body.classList.add('landing-mode');
  const root = $('#landing');
  root.hidden = false;
  const form = $('#auth-form');
  const error = root.querySelector('.form-error');
  const note = form.querySelector('.auth-note');
  const card = root.querySelector('.mail-card');
  const tabs = root.querySelector('.auth .tabs');
  let mode = 'login';
  let permit = null; // para añadir el correo a una cuenta antigua
  let resend = null; // repetir el último envío de correo

  const field = (name) => form.querySelector(`[name="${name}"]`);

  const setMode = (m) => {
    mode = m;
    const def = MODES[m];
    form.hidden = false;
    card.hidden = true;
    tabs.hidden = !def.tabs;
    root.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === m));
    form.querySelectorAll('[data-modes]').forEach((el) => (el.hidden = !el.dataset.modes.split(' ').includes(m)));
    for (const span of form.querySelectorAll('[data-label-login], [data-label-reset]')) {
      span.dataset.base ??= span.textContent;
      span.textContent = span.dataset[`label${m[0].toUpperCase()}${m.slice(1)}`] ?? span.dataset.base;
    }
    field('password').autocomplete = m === 'login' ? 'current-password' : 'new-password';
    field('username').maxLength = m === 'login' ? 120 : 20;
    form.querySelector('[type="submit"]').textContent = def.submit;
    note.hidden = !def.note;
    note.textContent = def.note ?? '';
    error.textContent = '';
  };

  /** Tarjeta de «revisa tu correo», con la opción de mandarlo otra vez. */
  const showSent = (text, again) => {
    resend = again;
    form.hidden = true;
    tabs.hidden = true;
    card.hidden = false;
    card.querySelector('.mail-text').innerHTML = text;
    const btn = card.querySelector('[data-action="mail-resend"]');
    btn.disabled = false;
    btn.textContent = 'Mandarlo otra vez';
  };
  card.querySelector('[data-action="mail-resend"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await resend?.();
      btn.textContent = '✔ Mandado otra vez';
    } catch (err) {
      btn.textContent = err.message;
    }
  });
  card.querySelector('[data-action="mail-back"]').addEventListener('click', () => setMode(mode));

  root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.tab)));
  root.querySelector('[data-action="go-register"]')?.addEventListener('click', () => {
    setMode('register');
    field('email').focus();
  });
  root.querySelector('[data-action="go-forgot"]').addEventListener('click', () => {
    setMode('forgot');
    field('email').focus();
  });
  root.querySelector('[data-action="go-login"]').addEventListener('click', () => {
    permit = null;
    setMode('login');
  });

  /** Comprueba el formulario antes de mandarlo; devuelve el error o null. */
  const check = (data) => {
    const visible = (name) => !field(name).closest('label').hidden;
    if (visible('email') && !EMAIL_RE.test(data.email.trim())) return 'Escribe un correo válido.';
    if (visible('username') && data.username.trim().length < 3) return mode === 'login' ? 'Escribe tu nombre o tu correo.' : 'El nombre debe tener al menos 3 letras.';
    if (visible('password') && data.password.length < 6) return 'La contraseña debe tener al menos 6 caracteres.';
    if (visible('password2') && data.password !== data.password2) return 'Las contraseñas no coinciden.';
    return null;
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const problem = check(data);
    if (problem) {
      error.textContent = problem;
      return;
    }
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    error.textContent = '';
    try {
      if (mode === 'login') {
        const res = await api('POST', '/api/login', { username: data.username, password: data.password });
        if (res.needEmail) {
          permit = res.permit;
          setMode('email');
          field('email').focus();
        } else {
          setToken(res.token);
          onLogin();
        }
      } else if (mode === 'register') {
        const body = { email: data.email, username: data.username, city: data.city, password: data.password, password2: data.password2 };
        const send = () => api('POST', '/api/register', body);
        const res = await send();
        showSent(`Te hemos mandado un correo a <b>${escapeHtml(res.email)}</b>. Abre el enlace para confirmar la cuenta y fundar tu ciudad.`, send);
      } else if (mode === 'email') {
        const body = { permit, email: data.email };
        const send = () => api('POST', '/api/email/start', body);
        const res = await send();
        showSent(`Te hemos mandado un correo a <b>${escapeHtml(res.email)}</b>. Abre el enlace para confirmarlo y seguirás jugando donde lo dejaste.`, send);
      } else if (mode === 'forgot') {
        const body = { email: data.email };
        const send = () => api('POST', '/api/forgot', body);
        await send();
        showSent(`Si <b>${escapeHtml(data.email.trim())}</b> es el correo de una cuenta, te llegará un enlace para poner otra contraseña. Vale durante 1 hora.`, send);
      } else if (mode === 'reset') {
        const res = await api('POST', '/api/reset', { token: resetToken, password: data.password, password2: data.password2 });
        setToken(res.token);
        onLogin();
      }
    } catch (err) {
      error.textContent = err.message;
    } finally {
      submit.disabled = false;
    }
  });

  setMode(firstMode);
  if (message) error.textContent = message;
  loadStats();
}

async function loadStats() {
  const el = $('#world-stats');
  try {
    const s = await api('GET', '/api/stats');
    const top = s.top.length
      ? `<ol class="mini-rank">${s.top.map((r) => `<li><span>${escapeHtml(r.name)}</span><b>${fmtNum(r.points)}</b></li>`).join('')}</ol>`
      : '<p class="muted small">Todavía no hay nadie. ¡Sé el primero en fundar una ciudad!</p>';
    el.innerHTML = `
      <div class="stat-row"><div><b>${fmtNum(s.players)}</b><span>capitanes</span></div><div><b>${fmtNum(s.online)}</b><span>en línea</span></div></div>
      ${s.event ? `<div class="landing-event">${s.event.icon} <b>${escapeHtml(s.event.name)}</b><div class="small">${escapeHtml(s.event.text)}</div></div>` : ''}
      <h4>Los imperios más grandes</h4>${top}`;
  } catch {
    el.innerHTML = '<p class="muted small">No se puede conectar con el servidor ahora mismo.</p>';
  }
}
