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
    root.querySelectorAll('.rec').forEach((el) => (el.hidden = m !== 'recover'));
    root.querySelectorAll('.pw2').forEach((el) => (el.hidden = m === 'login'));
    root.querySelector('.forgot').hidden = m !== 'login';
    root.querySelector('.pw-label').textContent = m === 'recover' ? 'Contraseña nueva' : 'Contraseña';
    form.querySelector('[name="code"]').required = m === 'recover';
    form.querySelector('[name="password"]').autocomplete = m === 'login' ? 'current-password' : 'new-password';
    form.querySelector('[type="submit"]').textContent = { register: 'Fundar mi ciudad', recover: 'Cambiar la contraseña', login: 'Entrar' }[m];
    error.textContent = '';
  };
  root.querySelector('[data-action="go-recover"]').addEventListener('click', () => {
    setMode('recover');
    form.querySelector('[name="username"]').focus();
  });

  // Tras crear la cuenta (o recuperarla), el código nuevo se enseña una vez
  const card = root.querySelector('.recovery-card');
  const showCode = (code) => {
    form.hidden = true;
    root.querySelector('.auth .tabs').hidden = true;
    card.hidden = false;
    card.querySelector('.recovery-code').textContent = code;
    card.querySelector('[data-action="copy-code"]').onclick = async (e) => {
      try {
        await navigator.clipboard.writeText(code);
        e.target.textContent = '✔ Copiado';
      } catch {
        e.target.textContent = 'Cópialo a mano';
      }
    };
    card.querySelector('[data-action="code-saved"]').onclick = () => onLogin();
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
    if (mode !== 'login' && data.password !== data.password2) {
      error.textContent = 'Las contraseñas no coinciden.';
      return;
    }
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    error.textContent = '';
    try {
      const path = { register: '/api/register', recover: '/api/recover', login: '/api/login' }[mode];
      const { token, recovery } = await api('POST', path, { username: data.username, password: data.password, city: data.city, code: data.code });
      setToken(token);
      if (recovery) showCode(recovery);
      else onLogin();
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
      ${s.event ? `<div class="landing-event">${s.event.icon} <b>${escapeHtml(s.event.name)}</b><div class="small">${escapeHtml(s.event.text)}</div></div>` : ''}
      <h4>Los imperios más grandes</h4>${top}`;
  } catch {
    el.innerHTML = '<p class="muted small">No se puede conectar con el servidor ahora mismo.</p>';
  }
}
