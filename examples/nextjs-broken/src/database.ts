import Database from 'better-sqlite3';

// DRC003: Local SQLite database file on serverless platform
const db = new Database('./data/app.sqlite');

export function getUsers() {
  const secretKey = process.env.INTERNAL_JWT_SECRET;
  if (!secretKey) {
    throw new Error('Missing secret');
  }
  return db.prepare('SELECT id, email FROM users').all();
}
