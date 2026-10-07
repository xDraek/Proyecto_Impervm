import { api, setToken } from '../net/api.js';
import { escapeHtml, fmtNum } from './format.js';

// Pantalla principal: presentación del juego, entrar o crear una cuenta.

const $ = (sel) => document.querySelector(sel);

export function showLanding({ onLogin, message }) {
  document.body.classList.add('landing-mode');
  const root = $('#landing');
  root.hidden = false;
  const form = $('#auth-form');
  const error = root.querySelector('.form-error');
  let mode = 'login';
  if (message) error.textContent = message;

  const setMode = (m) => {
    mode = m;
    root.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === m));
    root.querySelectorAll('.reg').forEach((el) => (el.hidden = m !== 'register'));
    form.querySelector('[name="password"]').autocomplete = m === 'register' ? 'new-password' : 'current-password';
    form.querySelector('[type="submit"]').textContent = m === 'register' ? 'Fundar mi ciudad' : 'Entrar';
    error.textContent = '';
  };
  root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.tab)));
  root.querySelector('[data-action="go-register"]')?.addEventListener('click', () => {
    setMode('register');
    form.querySelector('[name="username"]').focus();
  });
  setMode('login');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (mode === 'register' && data.password !== data.password2) {
      error.textContent = 'Las contraseñas no coinciden.';
      return;
    }
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    error.textContent = '';
    try {
      const path = mode === 'register' ? '/api/register' : '/api/login';
      const { token } = await api('POST', path, { username: data.username, password: data.password, city: data.city });
      setToken(token);
      onLogin();
    } catch (err) {
      error.textContent = err.message;
      submit.disabled = false;
    }
  });

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
      <h4>Los imperios más grandes</h4>${top}`;
  } catch {
    el.innerHTML = '<p class="muted small">No se puede conectar con el servidor ahora mismo.</p>';
  }
}
