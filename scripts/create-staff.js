// Создание сотрудника: node scripts/create-staff.js email роль [prices]
//   роль: admin | manager;  третий аргумент "prices" — доступ только к ценам.
const crypto = require('crypto');
const { db } = require('../server/db');
const auth = require('../server/lib/auth');

(async () => {
  const [email, role = 'manager', scope = ''] = process.argv.slice(2);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || !['admin', 'manager'].includes(role)) {
    console.error('Использование: node scripts/create-staff.js email admin|manager [prices]'); process.exit(1);
  }
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const password = Array.from(crypto.randomBytes(16), b => alphabet[b % alphabet.length]).join('') + '7';
  const hash = await auth.hashPassword(password), sc = role === 'manager' && scope === 'prices' ? 'prices' : '';
  const ex = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (ex) db.prepare('UPDATE users SET password_hash = ?, role = ?, scope = ?, is_active = 1 WHERE id = ?').run(hash, role, sc, ex.id);
  else db.prepare('INSERT INTO users(email,password_hash,name,role,scope) VALUES(?,?,?,?,?)').run(email, hash, '', role, sc);
  console.log(`Сотрудник: ${email}, роль: ${role}${sc ? ' (только цены)' : ''}\nПароль (покажется один раз): ${password}`);
})();
