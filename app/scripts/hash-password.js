#!/usr/bin/env node
/**
 * Erzeugt einen bcrypt-Hash aus einem Klartext-Passwort.
 *
 * Verwendung:
 *   node scripts/hash-password.js
 *     → fragt das Passwort interaktiv ab (wird nicht angezeigt)
 *
 *   node scripts/hash-password.js "mein-passwort"
 *     → direkt als Argument (Vorsicht: landet in der Shell-History!)
 *
 * Der ausgegebene Hash gehoert in die ENV-Variable DASHBOARD_PASSWORD_HASH
 * (lokal in .env, auf dem Plesk-Server im Node.js-App-Panel).
 */

const bcrypt = require('bcryptjs');
const readline = require('readline');

const ROUNDS = 12;

async function main() {
  let password = process.argv[2];

  if (!password) {
    password = await prompt('Dashboard-Passwort: ');
  }

  if (!password || password.length < 6) {
    console.error('Fehler: Passwort muss mindestens 6 Zeichen lang sein.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, ROUNDS);
  console.log('\nbcrypt-Hash (fuer DASHBOARD_PASSWORD_HASH):');
  console.log(hash);
  console.log('\nIn lokale .env schreiben:');
  console.log(`DASHBOARD_PASSWORD_HASH=${hash}`);
}

function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    // Einfache Maskierung — nicht perfekt auf allen Terminals, reicht aber
    const stdin = process.openStdin();
    process.stdin.on('data', () => {}); // no-op
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

main().catch(err => {
  console.error('Fehler:', err.message);
  process.exit(1);
});
