const http = require('http');
const fs = require('fs');
const path = require('path');

const port = process.env.PORT || 3000;
const html = fs.readFileSync(path.join(__dirname, 'index.html'));

const SL = process.env.SMARTLEAD_KEY || process.env.SmartLead_KEY || process.env.SMARTLEAD_API_KEY || '';
const HR = process.env.HEYREACH_KEY || process.env.HeyReach_KEY || process.env.HEYREACH_API_KEY || '';
const SL_CAMPAIGNS = [{ id: 3554436, name: 'Seniors' }, { id: 3554160, name: 'Structural' }];
const HR_ACCOUNTS = [{ id: 208941, name: 'Jan' }, { id: 198373, name: 'Ahmed' }];
const ACC = { 208941: 'Jan', 198373: 'Ahmed' };
const WINDOW_DAYS = 12;

const TYPES = {
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};

let cache = { data: null, ts: 0 };

function statusOf(t) {
  t = (t || '').toLowerCase();
  if (/\b(no|not|don't|outsource|outsourced|external|sorry|already have|no thanks|remove)\b/.test(t)) return 'Not now';
  if (t.includes('?')) return 'Question';
  if (/\b(yes|sure|interested|share|please|okay|ok|great|sounds good|happy to|go ahead|tell me more)\b/.test(t)) return 'Interested';
  return 'Replied';
}

function dayList(n) {
  const out = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function slDay(id, day) {
  try {
    const r = await fetch('https://server.smartlead.ai/api/v1/campaigns/' + id + '/analytics-by-date?api_key=' + SL + '&start_date=' + day + '&end_date=' + day);
    const d = await r.json();
    return { sent: +d.sent_count || 0, replied: +d.reply_count || 0, bounce: +d.bounce_count || 0 };
  } catch (e) { return { sent: 0, replied: 0, bounce: 0 }; }
}

async function emailData(days) {
  const out = {};
  await Promise.all(SL_CAMPAIGNS.map(async c => {
    const daily = {};
    await Promise.all(days.map(async day => { daily[day] = await slDay(c.id, day); }));
    let sent = 0, replied = 0, bounce = 0;
    days.forEach(day => { sent += daily[day].sent; replied += daily[day].replied; bounce += daily[day].bounce; });
    out[c.name] = { sent, replied, bounce, daily };
  }));
  return out;
}

async function hrData(days) {
  const out = {};
  const start = days[0] + 'T00:00:00Z';
  const end = new Date(new Date(days[days.length - 1] + 'T00:00:00Z').getTime() + 86400000).toISOString();
  await Promise.all(HR_ACCOUNTS.map(async a => {
    const daily = {}; days.forEach(d => daily[d] = { invites: 0, accepted: 0, replies: 0 });
    let invites = 0, accepted = 0, replies = 0, interested = 0, contacted = 0, messaged = 0, messages = 0;
    try {
      const r = await fetch('https://api.heyreach.io/api/public/stats/GetOverallStats', {
        method: 'POST', headers: { 'X-API-KEY': HR, 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountIds: [a.id], campaignIds: [], startDate: start, endDate: end })
      });
      const d = await r.json();
      const bd = d.byDayStats || {};
      for (const k in bd) {
        const day = k.slice(0, 10); const s = bd[k];
        if (daily[day]) daily[day] = { invites: s.connectionsSent || 0, accepted: s.connectionsAccepted || 0, replies: s.totalMessageReplies || 0 };
        invites += s.connectionsSent || 0; accepted += s.connectionsAccepted || 0; replies += s.totalMessageReplies || 0;
        interested += s.autoTaggedInterested || 0; contacted += s.uniqueLeadsContacted || 0;
        messaged += s.totalMessageStarted || 0; messages += s.messagesSent || 0;
      }
    } catch (e) { /* skip */ }
    out[a.name] = { invites, accepted, messaged, messages, replies, interested, contacted, daily };
  }));
  return out;
}

async function replyList() {
  if (!HR) return { items: [], err: 'no HEYREACH_KEY' };
  try {
    const r = await fetch('https://api.heyreach.io/api/public/inbox/GetConversationsV2', {
      method: 'POST', headers: { 'X-API-KEY': HR, 'Content-Type': 'application/json' },
      body: JSON.stringify({ filters: {}, offset: 0, limit: 100 })
    });
    if (!r.ok) return { items: [], err: 'heyreach ' + r.status };
    const d = await r.json();
    const out = [];
    for (const c of (d.items || [])) {
      const repliedLast = (c.lastMessageSender || '').toUpperCase() !== 'ME';
      if ((c.totalMessages || 0) < 2 && !repliedLast) continue;
      const pr = c.correspondentProfile || {};
      const tags = (pr.tags && pr.tags.length) ? pr.tags : [];
      out.push({
        account: ACC[c.linkedInAccountId] || '?', channel: 'LinkedIn',
        first: pr.firstName || '', company: pr.companyName || '',
        tags: tags, status: tags[0] || (repliedLast ? 'New reply' : 'Answered'),
        text: c.lastMessageText || '', awaiting: repliedLast, when: c.lastMessageAt || ''
      });
    }
    return { items: out, err: null };
  } catch (e) { return { items: [], err: String(e) }; }
}

async function slReplies() {
  if (!SL) return [];
  const out = [], seen = new Set();
  await Promise.all(SL_CAMPAIGNS.map(async c => {
    try {
      const r = await fetch('https://server.smartlead.ai/api/v1/campaigns/' + c.id + '/statistics?api_key=' + SL + '&limit=500');
      const d = await r.json();
      for (const row of (d.data || [])) {
        const cat = row.lead_category;
        if (!cat || cat === 'Sender Originated Bounce') continue;
        const key = (row.lead_email || row.lead_name || '') + '';
        if (seen.has(key)) continue; seen.add(key);
        out.push({
          account: 'Ahmed', channel: 'Email', campaign: c.name,
          first: (row.lead_name || '').split(' ')[0], company: row.company_name || '',
          tags: [cat], status: cat, text: '', awaiting: false, when: row.reply_time || row.sent_time || ''
        });
      }
    } catch (e) { /* skip */ }
  }));
  return out;
}

async function build() {
  if (cache.data && Date.now() - cache.ts < 120000) return cache.data;
  const days = dayList(WINDOW_DAYS);
  const [email, linkedin, hrReps, slReps] = await Promise.all([
    SL ? emailData(days) : Promise.resolve({}),
    HR ? hrData(days) : Promise.resolve({}),
    replyList(),
    SL ? slReplies() : Promise.resolve([])
  ]);
  const replies = hrReps.items.concat(slReps).sort((a, b) => (b.when || '').localeCompare(a.when || ''));
  const data = { updated: new Date().toISOString(), days, email, linkedin, replies, repliesErr: hrReps.err };
  cache = { data, ts: Date.now() };
  return data;
}

http.createServer(async (req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
  if (url === '/api/data' || url === '/api/live') {
    try { const d = await build(); res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(d)); }
    catch (e) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(e) })); }
    return;
  }
  const ext = path.extname(url).toLowerCase();
  if (TYPES[ext]) {
    const file = path.join(__dirname, path.basename(url));
    if (fs.existsSync(file)) { res.writeHead(200, { 'Content-Type': TYPES[ext], 'Content-Disposition': 'attachment; filename="' + path.basename(url) + '"' }); res.end(fs.readFileSync(file)); return; }
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html);
}).listen(port, () => console.log('GSD dashboard live on port ' + port));
