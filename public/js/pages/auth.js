import { h, toast, modal } from '../util.js';
import { post, refreshMe, reconnectWs, state } from '../api.js';

const authCard = (title, ...kids) => h('div', { class: 'auth-wrap' }, h('div', { class: 'card auth-card' }, h('h1', { style: { fontSize: '1.9rem' } }, title), ...kids));
const field = (label, input, hint) => h('label', { class: 'field' }, h('span', null, label), input, hint ? h('small', { class: 'muted' }, hint) : null);
async function afterAuth(ctx) { await refreshMe(); reconnectWs(); ctx.navigate(ctx.query.next ? decodeURIComponent(ctx.query.next) : '/'); }

export async function login(root, ctx) {
  ctx.setTitle('Log in');
  const u = h('input', { name: 'username', autocomplete: 'username', required: true, autofocus: true }), p = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true });
  const err = h('div', { class: 'form-error', role: 'alert' });
  const f = h('form', { onsubmit: async (e) => { e.preventDefault(); err.textContent = ''; try { await post('/api/auth/login', { username: u.value.trim(), password: p.value }); toast('Welcome back!', 'success'); await afterAuth(ctx); } catch (x) { err.textContent = x.message; } } },
    field('Username or email', u), field('Password', p), err, h('button', { class: 'btn primary block large', type: 'submit' }, 'Log in'));
  root.append(authCard('Log in', f, h('p', { class: 'center', style: { marginTop: '14px' } }, h('a', { href: '#/forgot' }, 'Forgot your password?')), h('p', { class: 'center muted' }, 'New here? ', h('a', { href: '#/register' }, 'Create a free account'))));
}
export default login;

export async function register(root, ctx) {
  ctx.setTitle('Sign up');
  const u = h('input', { name: 'username', autocomplete: 'username', required: true, minLength: 3, maxLength: 20, pattern: '[A-Za-z0-9_\\-]{3,20}' }), e = h('input', { type: 'email', name: 'email', autocomplete: 'email' }), p = h('input', { type: 'password', name: 'password', autocomplete: 'new-password', required: true, minLength: 8 }), p2 = h('input', { type: 'password', autocomplete: 'new-password', required: true });
  const err = h('div', { class: 'form-error', role: 'alert' });
  const f = h('form', { onsubmit: async (ev) => {
    ev.preventDefault(); err.textContent = '';
    if (p.value !== p2.value) { err.textContent = 'Passwords do not match'; return; }
    try {
      const r = await post('/api/auth/register', { username: u.value.trim(), password: p.value, email: e.value.trim() || undefined });
      await refreshMe(); reconnectWs();
      const code = h('code', { class: 'recovery-code' }, r.recoveryCode);
      const m = modal('Save your recovery code', h('div', null,
        h('p', null, 'This code lets you reset your password if you forget it. It is shown only once — store it somewhere safe.'), code,
        r.firstUserIsAdmin ? h('p', { class: 'pill accent' }, 'You are the first user, so you are the site administrator.') : null,
        h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'btn', onclick: () => { navigator.clipboard?.writeText(r.recoveryCode); toast('Copied'); } }, 'Copy'))),
        { onClose: () => ctx.navigate(ctx.query.next ? decodeURIComponent(ctx.query.next) : '/play'), actions: [h('button', { class: 'btn primary', onclick: () => m.close() }, 'I have saved it')] });
    } catch (x) { err.textContent = x.message; }
  } }, field('Username', u, '3–20 letters, numbers, _ or -'), field('Email (optional)', e, 'Only used to email you a password reset link'), field('Password', p, 'At least 8 characters'), field('Repeat password', p2), err, h('button', { class: 'btn primary block large', type: 'submit' }, 'Create free account'), h('p', { class: 'muted center small', style: { marginTop: '10px' } }, 'Free forever. No card, no ads, no premium tier.'));
  root.append(authCard('Create your account', f, h('p', { class: 'center muted' }, 'Already registered? ', h('a', { href: '#/login' }, 'Log in'))));
}

export async function forgot(root, ctx) {
  ctx.setTitle('Reset password');
  const id = h('input', { required: true }), r1 = h('input', { required: true }), code = h('input', { placeholder: 'xxxx-xxxx-xxxx', required: true }), np = h('input', { type: 'password', minLength: 8, required: true });
  const msg = h('div', { class: 'form-error', role: 'alert' });
  const a = h('form', { onsubmit: async (e) => { e.preventDefault(); try { const r = await post('/api/auth/forgot', { identifier: id.value.trim() }); msg.className = 'form-ok'; msg.textContent = r.message; } catch (x) { msg.className = 'form-error'; msg.textContent = x.message; } } },
    h('h3', null, 'Option 1 — email link'), h('p', { class: 'muted small' }, 'If your account has an email address we will send a reset link. (On a self-hosted install without a mail relay the message is written to data/outbox/ for the administrator to deliver.)'), field('Username or email', id), h('button', { class: 'btn', type: 'submit' }, 'Send reset link'));
  const b = h('form', { onsubmit: async (e) => { e.preventDefault(); try { await post('/api/auth/reset', { username: r1.value.trim(), recoveryCode: code.value.trim(), password: np.value }); toast('Password changed — log in with it now', 'success'); ctx.navigate('/login'); } catch (x) { msg.className = 'form-error'; msg.textContent = x.message; } } },
    h('h3', { style: { marginTop: '24px' } }, 'Option 2 — recovery code'), field('Username', r1), field('Recovery code (shown when you registered)', code), field('New password', np), h('button', { class: 'btn primary', type: 'submit' }, 'Reset password'));
  root.append(authCard('Forgot your password?', a, b, msg));
}

export async function reset(root, ctx) {
  ctx.setTitle('Choose a new password');
  const np = h('input', { type: 'password', minLength: 8, required: true, autocomplete: 'new-password' }); const err = h('div', { class: 'form-error' });
  root.append(authCard('Choose a new password', h('form', { onsubmit: async (e) => { e.preventDefault(); try { await post('/api/auth/reset', { token: ctx.params.token, password: np.value }); toast('Password changed', 'success'); ctx.navigate('/login'); } catch (x) { err.textContent = x.message; } } }, field('New password', np), err, h('button', { class: 'btn primary block', type: 'submit' }, 'Save password'))));
}
