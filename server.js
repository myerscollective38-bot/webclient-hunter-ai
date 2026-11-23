// WebClient Hunter AI — zero-dependency Node 18+ server.
// Lead discovery: OpenStreetMap (Nominatim + Overpass). AI: Google Gemini free tier (optional).
const http = require('http'), fs = require('fs'), path = require('path');
try { fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n').forEach(l => { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }); } catch {}
const PORT = process.env.PORT || 3000, DATA = process.env.DATA_DIR || path.join(__dirname, 'data'), DBF = path.join(DATA, 'db.json');
if (process.env.NODE_ENV === 'production' && !process.env.APP_PASSWORD) { console.error('APP_PASSWORD is required in production. Set it before starting the server.'); process.exit(1); }
fs.mkdirSync(DATA, { recursive: true });
let db = { leads: [], settings: { name: '', business: '', portfolio: '', language: 'English' } };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DBF, 'utf8'))); } catch {}
const save = () => { fs.writeFileSync(DBF + '.tmp', JSON.stringify(db)); fs.renameSync(DBF + '.tmp', DBF); };
const UA = 'WebClientHunter/1.0 (freelancer prospecting tool)';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const T = (k, v) => `["${k}"="${v}"]`, N = r => `["name"~"${r}",i]`;
const NICHES = {
  restaurants: [T('amenity', 'restaurant')], hotels: [T('tourism', 'hotel'), T('tourism', 'guest_house')],
  barbershops: [T('shop', 'hairdresser') + N('barber')], salons: [T('shop', 'hairdresser'), T('shop', 'beauty')],
  'cleaning companies': [N('clean') + '["shop"!="dry_cleaning"]'], 'construction companies': [T('craft', 'builder'), T('office', 'construction_company')],
  'roofing companies': [T('craft', 'roofer')], plumbers: [T('craft', 'plumber')], electricians: [T('craft', 'electrician')],
  'auto repair shops': [T('shop', 'car_repair')], dentists: [T('amenity', 'dentist'), T('healthcare', 'dentist')], gyms: [T('leisure', 'fitness_centre')],
  'real estate agencies': [T('office', 'estate_agent')], 'law firms': [T('office', 'lawyer')], 'clothing stores': [T('shop', 'clothes')],
  'photography studios': [T('craft', 'photographer'), T('shop', 'photo')], 'landscaping businesses': [T('craft', 'gardener')], 'moving companies': [N('moving|movers|removals')],
};
const SOC = /facebook\.com|fb\.com|fb\.me|instagram\.com|linktr\.ee|wa\.me|whatsapp|tiktok|twitter\.com|x\.com|yelp\.|tripadvisor\.|google\.[a-z.]+\/maps|goo\.gl/i;
const url = u => u ? (/^https?:\/\//i.test(u) ? u : 'https://' + u.replace(/^\/+/, '')) : '';
const social = (v, base) => !v ? '' : /^https?:|\.com/i.test(v) ? url(v) : base + v.replace(/^@/, '');

async function jfetch(u, opt = {}, ms = 30000) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(u, { ...opt, signal: ac.signal, headers: { 'user-agent': UA, ...(opt.headers || {}) } }); } finally { clearTimeout(t); }
}
async function scopeFor(city, country) {
  const q = [city, country].filter(Boolean).join(', ');
  const r = await jfetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q));
  if (!r.ok) throw new Error('Geocoding service unavailable (HTTP ' + r.status + ')');
  const g = (await r.json())[0];
  if (!g) throw new Error(`Could not find "${q}". Check the spelling of the country/city.`);
  if (g.osm_type === 'relation') return { clause: '(area.a)', pre: `area(${3600000000 + +g.osm_id})->.a;` };
  if (g.osm_type === 'way') return { clause: '(area.a)', pre: `area(${2400000000 + +g.osm_id})->.a;` };
  const b = g.boundingbox; return { clause: `(${b[0]},${b[2]},${b[1]},${b[3]})`, pre: '' };
}
async function overpass(niche, scope, cap) {
  const filters = NICHES[niche.toLowerCase()] || [N(niche.replace(/[^\p{L}\p{N} ]/gu, '').trim() || 'shop')];
  const q = `[out:json][timeout:40];${scope.pre}(${filters.map(f => `nwr${f}["name"]${scope.clause};`).join('')});out center tags ${cap};`;
  let last;
  for (const ep of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']) {
    try { const r = await jfetch(ep, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q) }, 50000); if (r.ok) return (await r.json()).elements || []; last = 'HTTP ' + r.status; } catch (e) { last = e.message; }
  }
  throw new Error('Search source (OpenStreetMap Overpass) is busy or unreachable: ' + last + '. Try again in a minute or use a smaller area.');
}
async function analyze(site) {
  if (!site) return { status: 'none', issues: [] };
  if (SOC.test(site)) return { status: 'social-only', issues: [] };
  try {
    const res = await jfetch(site, { redirect: 'follow' }, 9000);
    if (res.status >= 400) return { status: 'broken', issues: [`Website returned HTTP ${res.status}`] };
    const html = (await res.text()).slice(0, 300000), issues = [];
    if (!/<meta[^>]+name=["']viewport/i.test(html)) issues.push('No mobile viewport tag (likely not mobile-friendly)');
    if (!res.url.startsWith('https')) issues.push('Not served over HTTPS');
    const ys = [...html.matchAll(/(?:©|&copy;|copyright)[^<]{0,40}?((?:19|20)\d\d)/gi)].map(m => +m[1]), y = Math.max(0, ...ys);
    if (y && y <= new Date().getFullYear() - 3) issues.push(`Footer copyright year is ${y}`);
    if (/<(marquee|blink|frameset)\b|swfobject|\.swf\b/i.test(html)) issues.push('Uses obsolete tech (Flash/frames/marquee)');
    if (!/<form|book|reserv|appointment|quote|contact/i.test(html)) issues.push('No visible inquiry or booking system');
    return { status: issues.length >= 2 ? 'outdated' : 'ok', issues };
  } catch (e) { return { status: 'broken', issues: ['Website could not be reached from this tool (' + (e.name === 'AbortError' ? 'timeout' : e.cause?.code || e.message) + ') — verify manually'] }; }
}
function scoreLead(l) {
  let s, why = [], st = l.websiteStatus;
  if (st === 'none') { s = 70; why.push('No website found in public sources'); }
  else if (st === 'social-only') { s = 75; why.push('Online presence is only social media / listings'); }
  else if (st === 'broken') { s = 72; why.push('Website appears broken or unreachable'); }
  else if (st === 'outdated') { s = 50; why.push('Website looks outdated'); }
  else { s = 8; why.push('Has a working website with no major issues detected'); }
  for (const i of l.issues) { const p = /viewport/.test(i) ? 12 : /inquiry/.test(i) ? 8 : /HTTPS/.test(i) ? 5 : /copyright/.test(i) ? 6 : /obsolete/.test(i) ? 10 : 0; if (p) { s += p; why.push(i); } }
  if (l.phone) { s += 8; why.push('Public phone listed — active, reachable business'); }
  if (l.openingHours) { s += 4; why.push('Opening hours listed — operating business'); }
  if (l.email || l.instagram || l.facebook || l.whatsapp) { s += 3; why.push('Has at least one more contact channel'); }
  if (!l.phone && !l.email && !l.instagram && !l.facebook && !l.whatsapp) why.push('No public contact details found — reach out via the Maps/OSM listing');
  s = Math.min(100, s); return { score: s, level: s >= 70 ? 'High' : s >= 40 ? 'Medium' : 'Low', why };
}
async function search({ country, city, niche, limit }) {
  if (!country || !niche) throw new Error('Country and business type are required.');
  limit = Math.max(1, Math.min(+limit || 20, 50));
  const scope = await scopeFor(city, country), els = await overpass(niche, scope, Math.min(limit * 5, 250));
  const seen = new Set(), cands = [];
  for (const e of els) { const t = e.tags || {}, id = `osm-${e.type}-${e.id}`; if (seen.has(id) || !t.name) continue; seen.add(id);
    const a = [t['addr:housenumber'], t['addr:street'], t['addr:city']].filter(Boolean).join(' ');
    cands.push({ id, name: t.name, category: niche, country, city: city || t['addr:city'] || '', address: a,
      phone: t.phone || t['contact:phone'] || '', whatsapp: t['contact:whatsapp'] || '', email: t.email || t['contact:email'] || '',
      instagram: social(t['contact:instagram'], 'https://instagram.com/'), facebook: social(t['contact:facebook'], 'https://facebook.com/'),
      website: url(t.website || t['contact:website'] || t.url || ''), openingHours: t.opening_hours || '',
      description: t.description || `Listed on OpenStreetMap as ${t.cuisine ? t.cuisine + ' ' : ''}${niche}${a ? ' at ' + a : ''}.`,
      sources: [`https://www.openstreetmap.org/${e.type}/${e.id}`],
      mapsUrl: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([t.name, a || city, country].join(' ')) });
  }
  let i = 0; const run = async () => { while (i < cands.length) { const l = cands[i++]; const a = await analyze(l.website); l.websiteStatus = a.status; l.issues = a.issues; Object.assign(l, scoreLead(l)); } };
  await Promise.all(Array.from({ length: 8 }, run));
  cands.sort((a, b) => b.score - a.score);
  const out = cands.slice(0, limit); let added = 0;
  out.forEach((l, k) => { const ex = db.leads.find(x => x.id === l.id); if (ex) out[k] = ex; else { Object.assign(l, { status: 'New Lead', notes: '', contactedAt: '', followUpAt: '', createdAt: new Date().toISOString() }); db.leads.push(l); added++; } });
  save(); return { leads: out, added, scanned: cands.length, note: cands.length ? '' : 'No businesses with that type were found in OpenStreetMap for this area. Try another niche or a bigger area.' };
}

async function gemini(prompt) {
  const m = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const r = await jfetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${process.env.GEMINI_API_KEY}`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.9, responseMimeType: 'application/json' } }) });
  const d = await r.json(); if (!r.ok) throw new Error('Gemini: ' + (d.error?.message || r.status));
  return JSON.parse(d.candidates[0].content.parts[0].text.replace(/```json|```/g, ''));
}
const facts = l => ({ name: l.name, type: l.category, city: l.city, country: l.country, websiteStatus: l.websiteStatus, websiteIssues: l.issues, hasPhone: !!l.phone, instagram: l.instagram, facebook: l.facebook, description: l.description });
const SIT = l => ({ none: `I noticed ${l.name} doesn't seem to have its own website yet`, 'social-only': `I noticed ${l.name} mostly shows up on social media and online listings rather than on its own website`, broken: `I tried to open ${l.name}'s website and it didn't seem to load`, outdated: `I had a look at ${l.name}'s website and spotted a few things (${(l.issues || []).slice(0, 2).join('; ').toLowerCase()}) that may be costing you customers`, ok: `I came across ${l.name}'s website` }[l.websiteStatus] || `I came across ${l.name}`);
const BEN = ['A simple, fast website would let people in ' + '{c}' + ' find your hours, services and contact details in seconds — and reach you even when you are busy.', 'Customers search online before they call. A clean mobile-friendly site makes it easy for them to choose you and send an enquiry any time of day.', 'A website you own gives you a professional home online that works alongside your social pages and Google listing.'];
function template(l, s, v) {
  const sign = [s.name || '[Your name]', s.business, s.portfolio].filter(Boolean).join('\n'), ben = BEN[v % 3].replace('{c}', l.city || 'your area');
  return { subject: ['A website idea for ' + l.name, 'Quick question about ' + l.name + "'s online presence", 'Free website preview for ' + l.name][v % 3],
    email: `Hi ${l.name} team,\n\n${SIT(l)}. ${ben}\n\nI'm a freelance web designer, and I'd be happy to put together a free, no-obligation preview of what a site for ${l.name} could look like. Would you like me to send it over?\n\nKind regards,\n${sign}`,
    whatsapp: `Hi! I came across ${l.name}${l.city ? ' in ' + l.city : ''}. ${SIT(l).replace(/^I /, 'I ')}. I design websites for local businesses and could mock up a quick free preview for you — would you like to see it? 🙂`,
    instagram: `Hi ${l.name}! Love what you do${l.city ? ' in ' + l.city : ''}. I build websites for local businesses and noticed ${l.websiteStatus === 'none' ? "you don't have one yet" : 'yours could work harder for you'}. Happy to send a free preview if you're curious!` };
}
async function messages(l, v) {
  const s = db.settings;
  if (process.env.GEMINI_API_KEY) try {
    const r = await gemini(`You write outreach for a freelance web designer. Use ONLY these facts; never invent details, reviews, awards or claims.\nBusiness facts: ${JSON.stringify(facts(l))}\nSender: ${JSON.stringify(s)}\nWrite in ${s.language || 'English'}. Variation #${v}: use a different angle than other variations.\nReturn JSON {"subject","email","whatsapp","instagram"}. Email ≤120 words, explains how a website benefits them, offers a free website preview, friendly call to action. WhatsApp ≤50 words, casual, not salesy. Instagram DM ≤45 words, casual but professional. Do not claim anything was sent.`);
    return { ...r, mode: 'ai' };
  } catch (e) { return { ...template(l, s, v), mode: 'template', warning: e.message }; }
  return { ...template(l, s, v), mode: 'template' };
}
const SERV = { restaurants: ['Dine-in', 'Takeaway', 'Private events', 'Catering'], hotels: ['Rooms & suites', 'Breakfast', 'Events', 'Local tours'], barbershops: ['Haircuts', 'Beard trims', 'Hot towel shave', 'Kids cuts'], salons: ['Cut & colour', 'Styling', 'Treatments', 'Bridal'], dentists: ['Check-ups', 'Whitening', 'Fillings', 'Emergency care'], gyms: ['Memberships', 'Classes', 'Personal training', 'Day passes'], plumbers: ['Repairs', 'Installations', 'Emergency call-outs', 'Free quotes'], electricians: ['Wiring', 'Repairs', 'Lighting', 'Safety checks'], 'auto repair shops': ['Servicing', 'Diagnostics', 'Brakes & tyres', 'MOT prep'] };
async function demoHtml(l) {
  const sv = (SERV[l.category.toLowerCase()] || ['Our services', 'Free quotes', 'Reliable work', 'Friendly support']).map(t => ({ title: t, desc: 'Short description of this service goes here.' }));
  let c = { tagline: `Welcome to ${l.name}${l.city ? ' — proudly serving ' + l.city : ''}.`, intro: `${l.name} is a ${l.category.replace(/s$/, '')}${l.city ? ' based in ' + l.city : ''}. Replace this paragraph with the owner's own story.`, services: sv }, mode = 'template';
  if (process.env.GEMINI_API_KEY) try { c = await gemini(`Write website copy for a local business. Use ONLY these facts, invent nothing (no years in business, awards, prices, staff names): ${JSON.stringify(facts(l))}. Return JSON {"tagline","intro","services":[{"title","desc"}]} with exactly 4 services typical for this business type; intro ≤60 words.`); mode = 'ai'; } catch {}
  const h = [...l.name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 360, n = esc(l.name);
  const cta = l.phone ? [`tel:${l.phone.replace(/[^+\d]/g, '')}`, 'Call now'] : l.email ? [`mailto:${l.email}`, 'Email us'] : ['#contact', 'Get in touch'];
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${n}</title><style>
:root{--a:hsl(${h} 70% 45%);--b:hsl(${h} 40% 96%)}*{box-sizing:border-box}body{margin:0;font:16px/1.6 system-ui,sans-serif;color:#1c1c24}a{color:inherit}
header{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 5vw;position:sticky;top:0;background:#fff;border-bottom:1px solid #eee;flex-wrap:wrap}header nav a{margin-left:16px;text-decoration:none;font-size:14px}
.hero{padding:12vh 5vw;background:linear-gradient(135deg,var(--a),hsl(${(h + 40) % 360} 70% 30%));color:#fff}.hero h1{font-size:clamp(2rem,6vw,3.6rem);margin:0 0 12px}.hero p{max-width:560px;font-size:1.15rem}
.btn{display:inline-block;padding:12px 22px;border-radius:999px;background:#fff;color:var(--a);font-weight:600;text-decoration:none;margin:8px 8px 0 0}.btn.alt{background:transparent;color:#fff;border:2px solid #fff}
section{padding:56px 5vw}section.alt{background:var(--b)}h2{margin:0 0 20px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px}
.card{background:#fff;border:1px solid #e8e8ee;border-radius:12px;padding:20px}.ph{aspect-ratio:4/3;border-radius:12px;background:linear-gradient(135deg,hsl(${h} 50% 85%),hsl(${(h + 60) % 360} 50% 80%));display:grid;place-items:center;font-size:13px;color:#555}
.note{font-size:13px;background:#fff7d6;border:1px solid #f0dd8a;padding:8px 12px;border-radius:8px;margin-bottom:16px}footer{padding:24px 5vw;font-size:13px;color:#666;text-align:center}</style></head><body>
<header><b>${n}</b><nav><a href="#services">Services</a><a href="#gallery">Gallery</a><a href="#reviews">Reviews</a><a href="#contact">Contact</a></nav></header>
<div class="hero"><h1>${n}</h1><p>${esc(c.tagline)}</p><a class="btn" href="${esc(cta[0])}">${cta[1]}</a><a class="btn alt" href="#services">Our services</a></div>
<section><h2>About us</h2><p style="max-width:70ch">${esc(c.intro)}</p></section>
<section class="alt" id="services"><h2>Services</h2><div class="grid">${(c.services || sv).slice(0, 4).map(x => `<div class="card"><h3>${esc(x.title)}</h3><p>${esc(x.desc)}</p></div>`).join('')}</div></section>
<section id="gallery"><h2>Gallery</h2><div class="grid">${[1, 2, 3, 4, 5, 6].map(i => `<div class="ph">Photo placeholder ${i}</div>`).join('')}</div></section>
<section class="alt" id="reviews"><h2>What customers say</h2><div class="note">Sample testimonials — placeholder text only. Replace with real customer reviews.</div><div class="grid">${['Great service, easy to book. (Sample)', 'Friendly team and quick response. (Sample)', 'Would recommend to friends. (Sample)'].map(t => `<div class="card"><p>“${t}”</p><small>— Sample customer</small></div>`).join('')}</div></section>
<section id="contact"><h2>Contact</h2><p>${[l.address && esc(l.address), l.phone && `Phone: <a href="tel:${esc(l.phone.replace(/[^+\d]/g, ''))}">${esc(l.phone)}</a>`, l.email && `Email: <a href="mailto:${esc(l.email)}">${esc(l.email)}</a>`, l.openingHours && 'Hours: ' + esc(l.openingHours)].filter(Boolean).join('<br>') || 'Add address, phone and email here.'}</p><a class="btn" style="background:var(--a);color:#fff" href="${esc(cta[0])}">${cta[1]}</a></section>
<footer>Demo concept prepared by ${esc(db.settings.name || 'a freelance web designer')} — not the official website of ${n}.</footer></body></html>`;
  return { html, mode };
}

const body = req => new Promise((ok, no) => { let d = ''; req.on('data', c => { d += c; if (d.length > 1e6) req.destroy(); }); req.on('end', () => { try { ok(d ? JSON.parse(d) : {}); } catch { no(new Error('Invalid JSON')); } }); });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
http.createServer(async (req, res) => {
  const send = (c, o) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (process.env.APP_PASSWORD && (Buffer.from((req.headers.authorization || '').slice(6), 'base64').toString().split(':').slice(1).join(':') !== process.env.APP_PASSWORD)) { res.writeHead(401, { 'www-authenticate': 'Basic realm="WebClient Hunter"' }); return res.end('Password required'); }
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  try {
    if (p.startsWith('/api/')) {
      const m = req.method, lead = id => db.leads.find(l => l.id === id);
      if (p === '/api/config') return send(200, { ai: !!process.env.GEMINI_API_KEY, search: 'OpenStreetMap (live)' });
      if (p === '/api/leads' && m === 'GET') return send(200, db.leads);
      if (p === '/api/settings') { if (m === 'PUT') { db.settings = { ...db.settings, ...(await body(req)) }; save(); } return send(200, db.settings); }
      if (p === '/api/search' && m === 'POST') return send(200, await search(await body(req)));
      let mm = p.match(/^\/api\/leads\/(.+)$/);
      if (mm) { const l = lead(decodeURIComponent(mm[1])); if (!l) return send(404, { error: 'Lead not found' });
        if (m === 'DELETE') { db.leads = db.leads.filter(x => x !== l); save(); return send(200, { ok: true }); }
        if (m === 'PATCH') { const b = await body(req); for (const k of ['status', 'notes', 'contactedAt', 'followUpAt']) if (k in b) l[k] = String(b[k]); save(); return send(200, l); } }
      if (p === '/api/messages' && m === 'POST') { const b = await body(req), l = lead(b.id); if (!l) return send(404, { error: 'Lead not found' }); return send(200, await messages(l, +b.variant || 0)); }
      if (p === '/api/demo' && m === 'POST') { const l = lead((await body(req)).id); if (!l) return send(404, { error: 'Lead not found' }); return send(200, await demoHtml(l)); }
      return send(404, { error: 'Not found' });
    }
    const f = path.join(__dirname, 'public', p === '/' ? 'index.html' : p);
    if (!f.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(f)) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  } catch (e) { send(500, { error: e.message }); }
}).listen(PORT, '0.0.0.0', () => console.log(`WebClient Hunter AI running → http://0.0.0.0:${PORT}  (AI: ${process.env.GEMINI_API_KEY ? 'Gemini' : 'template demo mode'})`));
