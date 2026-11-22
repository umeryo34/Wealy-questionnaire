// 依存パッケージなしで動く投票サーバー（Node.js 18+）
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.env.PORT || 3002;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const VOTES_FILE = path.join(DATA_DIR, 'votes.json');
const QUESTIONS_FILE = path.join(ROOT, 'questions.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

function loadQuestions() {
  return JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf8'));
}

function loadVotes() {
  try {
    return JSON.parse(fs.readFileSync(VOTES_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveVotes(votes) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = VOTES_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(votes, null, 2));
  fs.renameSync(tmp, VOTES_FILE);
}

function summarize() {
  const questions = loadQuestions();
  const votes = loadVotes();
  const respondents = new Set(votes.map((v) => v.respondentId)).size;
  return {
    respondents,
    questions: questions.map((q) => {
      const qVotes = votes.filter((v) => v.questionId === q.id);
      const a = qVotes.filter((v) => v.choice === 'a').length;
      const b = qVotes.filter((v) => v.choice === 'b').length;
      return { ...q, counts: { a, b }, total: a + b };
    }),
  };
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': MIME['.json'] });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e5) req.destroy();
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (urlPath === '/') urlPath = '/index.html';
  if (urlPath === '/results') urlPath = '/results.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://x');

  if (req.method === 'GET' && pathname === '/api/questions') {
    return sendJson(res, 200, loadQuestions());
  }

  if (req.method === 'GET' && pathname === '/api/results') {
    return sendJson(res, 200, summarize());
  }

  if (req.method === 'POST' && pathname === '/api/votes') {
    try {
      const body = JSON.parse(await readBody(req));
      const { respondentId, answers } = body;
      if (typeof respondentId !== 'string' || !respondentId || typeof answers !== 'object' || !answers) {
        return sendJson(res, 400, { error: 'invalid body' });
      }
      const validIds = new Set(loadQuestions().map((q) => q.id));
      const votes = loadVotes();
      // 同じ回答者の再投票は上書き
      const kept = votes.filter((v) => v.respondentId !== respondentId);
      const now = new Date().toISOString();
      for (const [questionId, choice] of Object.entries(answers)) {
        if (validIds.has(questionId) && (choice === 'a' || choice === 'b')) {
          kept.push({ respondentId, questionId, choice, at: now });
        }
      }
      saveVotes(kept);
      return sendJson(res, 200, { ok: true });
    } catch {
      return sendJson(res, 400, { error: 'invalid json' });
    }
  }

  if (req.method === 'GET' && pathname === '/api/export.csv') {
    const rows = ['respondentId,questionId,choice,at', ...loadVotes().map((v) => [v.respondentId, v.questionId, v.choice, v.at].join(','))];
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="votes.csv"',
    });
    return res.end('﻿' + rows.join('\n'));
  }

  if (req.method === 'GET') return serveStatic(req, res);
  res.writeHead(405).end();
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`ポート${PORT}はすでに使われています。サーバーがもう起動していないか確認してください。`);
    console.error(`（別のポートで起動する場合: PORT=3001 npm start）`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`アンケート:   http://localhost:${PORT}/`);
  console.log(`集計結果:     http://localhost:${PORT}/results`);
  // 同じWi-Fiのタブレットから開くためのアドレス
  for (const list of Object.values(require('node:os').networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) {
        console.log(`タブレット用: http://${ni.address}:${PORT}/`);
      }
    }
  }
});
