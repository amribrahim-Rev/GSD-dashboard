const http = require('http');
const fs = require('fs');
const path = require('path');

const port = process.env.PORT || 3000;
const html = fs.readFileSync(path.join(__dirname, 'index.html'));

const SL = process.env.SMARTLEAD_KEY || process.env.SmartLead_KEY || process.env.SMARTLEAD_API_KEY || '';
const HR = process.env.HEYREACH_KEY || process.env.HeyReach_KEY || process.env.HEYREACH_API_KEY || process.env.HeyReach_Key || '';
const SL_CAMPAIGNS = [{ id: 3554436, name: 'Seniors' }, { id: 3554160, name: 'Structural' }];
const ACC = { 198373: 'Ahmed', 208941: 'Jan' };

const TYPES = {
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};

let cache = { data: null, ts: 0 };

function statusOf(t) {
  t = (t || '').toLowerCase();
  if (/\b(no|not|don't|outsource|outsourced|external|sorry|already have|no thanks)\b/.test(t)) return 'Not now';
  if (t.includes('?')) return 'Question';
  if (/\b(yes|sure|interested|share|please|okay|ok|great|sounds good|happy to|go ahead)\b/.test(t)) return 'Interested';
  return 'Replied';
}

async function getReplies() {
  if (!HR) return { items: [], err: 'no HEYREACH_KEY' };
  const r = await fetch('https://api.heyreach.io/api/public/inbox/GetConversationsV2', {
    method: 'POST',
    headers: { 'X-API-KEY': HR, 'Content-Type': 'application/json' },
    body: JSON.stringify({ filters: {}, offset: 0, limit: 100 })
  });
  if (!r.ok) return { items: [], err: 'heyreach ' + r.status };
  const d = await r.json();
  const items = d.items || [];
  const out = [];
  for (const c of items) {
    const inc = (c.messages || []).filter(m => (m.sender || '').toUpperCase() !== 'ME');
    const repliedLast = (c.lastMessageSender || '').toUpperCase() !== 'ME';
    if (inc.length === 0 && !repliedLast) continue;
    const pr = c.correspondentProfile || {};
    let txt = inc.length ? (inc[inc.length - 1].text || inc[inc.length - 1].body || '') : (repliedLast ? (c.lastMessageText || '') : '');
    out.push({
      account: ACC[c.linkedInAccountId] || '?',
      first: pr.firstName || '',
      company: pr.companyName || '',
      status: statusOf(txt),
      awaiting: repliedLast,
      when: c.lastMessageAt || ''
    });
  }
  out.sort((a, b) => (b.when || '').localeCompare(a.when || ''));
  return { items: out, err: null };
}

async function getEmails() {
  if (!SL) return [];
  const res = [];
  for (const c of SL_CAMPAIGNS) {
    try {
      const r = await fetch('https://server.smartlead.ai/api/v1/campaigns/' + c.id + '/analytics?api_key=' + SL);
      const d = await r.json();
      res.push({ name: c.name, sent: d.sent_count || 0, bounce: d.bounce_count || 0, reply: d.reply_count || 0 });
    } catch (e) { /* skip */ }
  }
  return res;
}

async function live() {
  if (cache.data && Date.now() - cache.ts < 60000) return cache.data;
  let replies = { items: [], err: null }, emails = [];
  try { replies = await getReplies(); } catch (e) { replies = { items: [], err: String(e) }; }
  try { emails = await getEmails(); } catch (e) { /* skip */ }
  const data = { updated: new Date().toISOString(), replies: replies.items, repliesErr: replies.err, emails };
  cache = { data, ts: Date.now() };
  return data;
}

http.createServer(async (req, res) => {
  const url = (req.url || '/').split('?')[0];

  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return;
  }

  if (url === '/api/live') {
    try {
      const data = await live();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  const ext = path.extname(url).toLowerCase();
  if (TYPES[ext]) {
    const file = path.join(__dirname, path.basename(url));
    if (fs.existsSync(file)) {
      res.writeHead(200, { 'Content-Type': TYPES[ext], 'Content-Disposition': 'attachment; filename="' + path.basename(url) + '"' });
      res.end(fs.readFileSync(file)); return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}).listen(port, () => console.log('GSD dashboard live on port ' + port));
