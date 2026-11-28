import { init, DB_PATH } from '../server/db.js';
init((m) => console.log(m));
console.log('database ready:', DB_PATH);
