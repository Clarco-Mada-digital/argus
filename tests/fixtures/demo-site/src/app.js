const API_KEY = "aB3xK9mQ7pL2vN8wR4tY6uZ1cD5eF0gH";
const DB = "postgres://admin:SuperSecret123@db.internal:5432/prod";

import { formatDate, unusedHelper } from './utils.js';
import moment from 'moment';

function render(user) {
  document.getElementById('name').innerHTML = user.bio;
  const html = "<div>" + user.name + "</div>";
  document.write(html);
}

async function loadAll(ids) {
  for (const id of ids) {
    const row = await db.query("SELECT * FROM users WHERE id = " + id);
    console.log("password", row.password);
  }
  return row;
  console.log('jamais atteint');
}

function auth(token) {
  const decoded = jwt.decode(token);
  const hash = md5(token);
  return decoded;
}

// function ancienneVersion(a, b) {
//   const total = a + b;
//   if (total > 10) { return total * 2; }
//   return total;
// }

fetch('http://api.exemple.com/data');
router.push('/dashboard');
