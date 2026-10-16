const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const SESSION_SECRET = process.env.SESSION_SECRET || 'development-only-change-me';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ChangeThisAdminPassword123!';

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'socialboost.db'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Promotion',
  points INTEGER NOT NULL DEFAULT 5,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS completions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  task_id INTEGER NOT NULL,
  points_awarded INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, task_id),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(task_id) REFERENCES tasks(id)
);
CREATE TABLE IF NOT EXISTS point_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  admin_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS reward_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  reward TEXT NOT NULL,
  points INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  admin_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
`);

const seedTasks = [
  ['Improve your profile bio', 'Review your bio and make it clear what your channel offers.', 'Profile', 8],
  ['Create a short-video idea', 'Write a strong opening hook and outline a useful short video.', 'Content', 12],
  ['Share content with a relevant audience', 'Share your public post where promotion is allowed; avoid spam.', 'Promotion', 10],
  ['Leave a meaningful comment', 'Write a genuine, relevant comment—never copy-paste spam.', 'Community', 5],
  ['Review your video title and thumbnail', 'Make your title accurate and your thumbnail easy to read.', 'Content', 8]
];
if (db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n === 0) {
  const insert = db.prepare('INSERT INTO tasks(title,description,category,points) VALUES(?,?,?,?)');
  const tx = db.transaction(rows => rows.forEach(row => insert.run(...row)));
  tx(seedTasks);
}
if (!db.prepare('SELECT id FROM users WHERE email=?').get(ADMIN_EMAIL)) {
  const hash = bcrypt.hashSync(ADMIN_PASSWORD, 12);
  db.prepare('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)')
    .run('Administrator', ADMIN_EMAIL, hash, 'admin');
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '30kb' }));
app.use(express.urlencoded({ extended: false, limit: '30kb' }));
app.use(session({
  name: 'sb.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 8 }
}));
app.use(express.static(path.join(__dirname, 'public')));

const safeUser = u => ({ id: u.id, name: u.name, email: u.email, points: u.points, role: u.role, created_at: u.created_at });
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Please sign in first.' });
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.session.userId);
  if (!user) { req.session.destroy(() => {}); return res.status(401).json({ error: 'Session expired. Sign in again.' }); }
  req.user = user; next();
}
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Administrator access required.' });
  next();
}
function validEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }

app.get('/api/health', (req,res) => res.json({ ok: true, name: 'SocialBoost Hub' }));
app.get('/api/me', requireAuth, (req,res) => res.json({ user: safeUser(req.user) }));

app.post('/api/register', (req,res) => {
  const name = String(req.body.name || '').trim().slice(0,60);
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (name.length < 2) return res.status(400).json({ error: 'Name must be at least 2 characters.' });
  if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 10) return res.status(400).json({ error: 'Password must be at least 10 characters.' });
  if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) return res.status(409).json({ error: 'That email is already registered.' });
  const hash = bcrypt.hashSync(password, 12);
  const result = db.prepare('INSERT INTO users(name,email,password_hash) VALUES(?,?,?)').run(name,email,hash);
  req.session.userId = result.lastInsertRowid;
  res.status(201).json({ user: safeUser(db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid)) });
});

app.post('/api/login', (req,res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Email or password is incorrect.' });
  req.session.userId = user.id;
  res.json({ user: safeUser(user) });
});
app.post('/api/logout', (req,res) => req.session.destroy(() => res.json({ ok: true })));

app.get('/api/tasks', requireAuth, (req,res) => {
  const tasks = db.prepare(`
    SELECT t.*, CASE WHEN c.id IS NULL THEN 0 ELSE 1 END AS completed
    FROM tasks t LEFT JOIN completions c ON c.task_id=t.id AND c.user_id=?
    WHERE t.active=1 ORDER BY t.id DESC`).all(req.user.id);
  res.json({ tasks });
});
app.post('/api/tasks/:id/complete', requireAuth, (req,res) => {
  const id = Number(req.params.id);
  const task = db.prepare('SELECT * FROM tasks WHERE id=? AND active=1').get(id);
  if (!task) return res.status(404).json({ error: 'Task not found or inactive.' });
  try {
    const tx = db.transaction(() => {
      db.prepare('INSERT INTO completions(user_id,task_id,points_awarded) VALUES(?,?,?)').run(req.user.id,task.id,task.points);
      db.prepare('UPDATE users SET points=points+? WHERE id=?').run(task.points,req.user.id);
      db.prepare('INSERT INTO point_ledger(user_id,amount,reason) VALUES(?,?,?)').run(req.user.id,task.points,'Completed task: '+task.title);
    });
    tx();
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'You already completed this task.' });
    throw e;
  }
  res.json({ user: safeUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)), message: 'Task recorded and points awarded.' });
});

app.get('/api/ledger', requireAuth, (req,res) => {
  res.json({ entries: db.prepare('SELECT amount,reason,created_at FROM point_ledger WHERE user_id=? ORDER BY id DESC LIMIT 50').all(req.user.id) });
});

app.get('/api/rewards', requireAuth, (req,res) => {
  res.json({ requests: db.prepare('SELECT id,reward,points,note,status,admin_note,created_at,updated_at FROM reward_requests WHERE user_id=? ORDER BY id DESC LIMIT 100').all(req.user.id) });
});
app.post('/api/rewards', requireAuth, (req,res) => {
  const reward = String(req.body.reward || '').trim();
  const points = Number(req.body.points);
  const note = String(req.body.note || '').trim().slice(0,180);
  const allowed = ['Mobile data reward','Gift voucher','Cash reward (manual review)'];
  if (!allowed.includes(reward)) return res.status(400).json({ error: 'Choose a valid reward option.' });
  if (!Number.isInteger(points) || points < 100 || points > 1000000) return res.status(400).json({ error: 'Enter at least 100 points.' });
  if (req.user.points < points) return res.status(400).json({ error: 'You do not have enough points.' });
  const result = db.prepare('INSERT INTO reward_requests(user_id,reward,points,note) VALUES(?,?,?,?)').run(req.user.id,reward,points,note);
  res.status(201).json({ id: result.lastInsertRowid, message: 'Reward request submitted for admin review.' });
});
app.get('/api/admin/summary', requireAuth, requireAdmin, (req,res) => {
  res.json({
    users: db.prepare('SELECT COUNT(*) n FROM users').get().n,
    tasks: db.prepare('SELECT COUNT(*) n FROM tasks').get().n,
    completions: db.prepare('SELECT COUNT(*) n FROM completions').get().n,
    pointsIssued: db.prepare('SELECT COALESCE(SUM(amount),0) n FROM point_ledger WHERE amount>0').get().n,
    members: db.prepare('SELECT id,name,email,points,role,created_at FROM users ORDER BY id DESC LIMIT 100').all(),
    tasksList: db.prepare('SELECT * FROM tasks ORDER BY id DESC').all(),
    rewardRequests: db.prepare('SELECT r.*,u.name,u.email FROM reward_requests r JOIN users u ON u.id=r.user_id ORDER BY r.id DESC LIMIT 100').all()
  });
});
app.post('/api/admin/rewards/:id/review', requireAuth, requireAdmin, (req,res) => {
  const status = String(req.body.status || '');
  const adminNote = String(req.body.adminNote || '').trim().slice(0,180);
  if (!['approved','rejected'].includes(status)) return res.status(400).json({ error: 'Choose approved or rejected.' });
  const request = db.prepare('SELECT * FROM reward_requests WHERE id=?').get(Number(req.params.id));
  if (!request) return res.status(404).json({ error: 'Reward request not found.' });
  if (request.status !== 'pending') return res.status(409).json({ error: 'This request has already been reviewed.' });
  const tx = db.transaction(() => {
    if (status === 'approved') {
      const user = db.prepare('SELECT points FROM users WHERE id=?').get(request.user_id);
      if (!user || user.points < request.points) throw new Error('INSUFFICIENT_POINTS');
      db.prepare('UPDATE users SET points=points-? WHERE id=?').run(request.points,request.user_id);
      db.prepare('INSERT INTO point_ledger(user_id,amount,reason,admin_id) VALUES(?,?,?,?)').run(request.user_id,-request.points,'Reward approved: '+request.reward,req.user.id);
    }
    db.prepare('UPDATE reward_requests SET status=?,admin_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status,adminNote,request.id);
  });
  try { tx(); } catch(e) { if(e.message==='INSUFFICIENT_POINTS') return res.status(400).json({error:'User no longer has enough points.'}); throw e; }
  res.json({ ok:true, message:'Reward request '+status+'.' });
});
app.post('/api/admin/points', requireAuth, requireAdmin, (req,res) => {
  const userId = Number(req.body.userId);
  const amount = Number(req.body.amount);
  const reason = String(req.body.reason || 'Administrator adjustment').trim().slice(0,160);
  if (!Number.isInteger(userId) || !Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 100000) return res.status(400).json({ error: 'Enter a valid user ID and a non-zero whole-number adjustment (max 100,000).' });
  const target = db.prepare('SELECT id,points FROM users WHERE id=?').get(userId);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (target.points + amount < 0) return res.status(400).json({ error: 'Points balance cannot become negative.' });
  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET points=points+? WHERE id=?').run(amount,userId);
    db.prepare('INSERT INTO point_ledger(user_id,amount,reason,admin_id) VALUES(?,?,?,?)').run(userId,amount,reason,req.user.id);
  });
  tx();
  res.json({ ok: true, message: 'Points adjusted.' });
});
app.post('/api/admin/tasks', requireAuth, requireAdmin, (req,res) => {
  const title = String(req.body.title || '').trim().slice(0,100);
  const description = String(req.body.description || '').trim().slice(0,300);
  const category = String(req.body.category || 'Promotion').trim().slice(0,40);
  const points = Number(req.body.points);
  if (title.length < 3 || description.length < 5 || !Number.isInteger(points) || points < 1 || points > 1000) return res.status(400).json({ error: 'Provide a title, description, and points between 1 and 1000.' });
  const result = db.prepare('INSERT INTO tasks(title,description,category,points) VALUES(?,?,?,?)').run(title,description,category,points);
  res.status(201).json({ task: db.prepare('SELECT * FROM tasks WHERE id=?').get(result.lastInsertRowid) });
});
app.patch('/api/admin/tasks/:id', requireAuth, requireAdmin, (req,res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'Task not found.' });
  const active = req.body.active === false ? 0 : 1;
  db.prepare('UPDATE tasks SET active=? WHERE id=?').run(active,task.id);
  res.json({ ok: true });
});

app.get('*', (req,res) => res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT, () => console.log(`SocialBoost Hub running at http://localhost:${PORT}`));
