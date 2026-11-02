// Разовая генерация bcrypt-хэша (cost 10) для демо-пароля. Результат вручную вписан в sql/02_seed.sql.
import bcrypt from 'bcryptjs';
const password = process.argv[2] || 'Shogird2026!';
console.log(bcrypt.hashSync(password, 10));
