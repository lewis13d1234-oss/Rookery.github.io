// Usage: npm run make-admin -- <username> [admin|mod|user]
import { init, q } from '../server/db.js';
init();
const [name, role = 'admin'] = process.argv.slice(2);
if (!name || !['admin', 'mod', 'user'].includes(role)) { console.error('usage: make-admin <username> [admin|mod|user]'); process.exit(1); }
const r = q.run('UPDATE users SET role=? WHERE username=?', role, name);
console.log(Number(r.changes) ? `${name} is now ${role}` : `no such user: ${name}`);
