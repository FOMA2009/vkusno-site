// Создание администратора: node scripts/create-admin.js you@example.com [пароль]
// Если пароль не указан, генерируется случайный и печатается один раз. Паролей по умолчанию нет.
const crypto = require('crypto');
const { db } = require('../server/db');
const auth = require('../server/lib/auth');

(async () => {
  const [email, given] = process.argv.slice(2);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { console.error('Использование: node scripts/create-admin.js email [пароль]'); process.exit(1); }
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const password = given || Array.from(crypto.randomBytes(16), b => alphabet[b % alphabet.length]).join('') + '7';
  const err = auth.validatePassword(password);
  if (err) { console.error(err); process.exit(1); }
  const hash = await auth.hashPassword(password);
  const ex = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (ex) db.prepare("UPDATE users SET password_hash = ?, role = 'admin', is_active = 1 WHERE id = ?").run(hash, ex.id);
  else db.prepare("INSERT INTO users(email,password_hash,name,role) VALUES(?,?,?,'admin')").run(email, hash, 'Администратор');
  console.log(`Администратор: ${email}`);
  if (!given) console.log(`Пароль (сохраните, он больше не будет показан): ${password}`);
})();
