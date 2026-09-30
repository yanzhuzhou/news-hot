/**
 * 全网社交平台热点榜单 - Cloudflare Worker（纯 Cloudflare 版）
 * 部署：控制台粘贴代码 + 绑定 KV（变量名 HOT_DATA，可选）+ 加 Cron（可选）。
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const SOURCES = {
  weibo:   { name: '微博热搜', unit: '万', urls: ['https://api.guiguiya.com/api/hotlist?type=weibo'] },
  douyin:  { name: '抖音热点', unit: '万', urls: ['https://api.guiguiya.com/api/hotlist?type=douyin'] },
  bilibili:{ name: 'B站热搜', unit: '',  urls: ['https://api.guiguiya.com/api/hotlist?type=bilihot', 'https://api.bilibili.com/x/web-interface/search/square?limit=10'] },
  baidu:   { name: '百度热搜', unit: '',  urls: ['https://api.guiguiya.com/api/hotlist?type=baidu'] },
  toutiao: { name: '头条热榜', unit: '',  urls: ['https://api.guiguiya.com/api/hotlist?type=toutiao'] },
};

const CATEGORY_KEYWORDS = {
  '科技': ['AI', '人工智能', '芯片', '半导体', '手机', '苹果', '华为', '小米', '科技', '互联网', '算法', '大模型', 'ChatGPT', '量子', '5G', '6G', '数码', '电动车', '新能源', '自动驾驶', '机器人', '百度', '腾讯', '阿里', '字节', 'OpenAI', '谷歌', '微软', '英伟达'],
  '社会': ['社会', '民生', '教育', '学校', '大学', '高考', '考研', '就业', '工资', '收入', '房价', '医保', '养老', '生育', '结婚', '离婚', '交通', '高铁', '地铁', '公交', '快递', '外卖', '城管', '物业', '社区'],
  '娱乐': ['娱乐', '明星', '演员', '歌手', '演唱会', '电影', '电视剧', '综艺', '选秀', '偶像', '粉丝', '娱乐圈', '影视', '音乐', '舞蹈', '说唱', '真人秀'],
  '体育': ['体育', '足球', '篮球', 'NBA', 'CBA', '乒乓', '羽毛球', '游泳', '田径', '奥运', '亚运', '世界杯', '欧冠', '联赛', '冠军', '运动员', '教练', '球队'],
  '财经': ['财经', '股市', 'A股', '基金', '银行', '利率', '汇率', '通胀', 'GDP', '经济', '消费', '出口', '进口', '贸易', '关税', '制裁', '并购', '上市', 'IPO', '美股', '港股', '比特币', '加密货币'],
  '政策': ['政策', '法规', '法律', '国务院', '人大', '政协', '政府', '部委', '通知', '意见', '规划', '方案', '改革', '试点', '实施', '废止', '发布', '出台'],
  '灾害': ['地震', '洪水', '台风', '暴雨', '暴雪', '干旱', '火灾', '泥石流', '山体滑坡', '海啸', '龙卷风', '极端天气', '高温', '寒潮'],
  '国际': ['国际', '美国', '日本', '韩国', '朝鲜', '俄罗斯', '乌克兰', '欧洲', '英国', '法国', '德国', '中东', '以色列', '巴勒斯坦', '联合国', '北约', 'G7', 'G20', '东盟'],
  '时政': ['主席', '总理', '总统', '会见', '访问', '会谈', '峰会', '外交', '领事', '大使馆', '访华', '出访'],
  '其他': [],
};

function categorize(title) {
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (cat === '其他') continue;
    for (const kw of keywords) { if (title.includes(kw)) return cat; }
  }
  return '其他';
}

function parseHeat(s) {
  if (!s) return 0;
  s = String(s).replace(/[,，]/g, '').trim();
  const m = s.match(/(\d+(?:\.\d+)?)/);
  let v = m ? parseFloat(m[1]) : 0;
  if (s.includes('亿')) v *= 10000;
  if (v >= 100000) v = Math.round(v / 10000 * 10) / 10;
  return v;
}

function formatHeat(s, unit) { return s ? String(s) + (unit || '') : '—'; }

function normalizeList(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.data && Array.isArray(raw.data.data)) return raw.data.data;
  if (Array.isArray(raw.data)) return raw.data;
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.data) && raw.data[0] && raw.data[0].target) return raw.data;
  if (raw.data && raw.data.trending && Array.isArray(raw.data.trending.list)) return raw.data.trending.list;
  return null;
}

function parseItems(raw, config) {
  const list = normalizeList(raw);
  if (!list || !list.length) return [];
  return list.slice(0, 10).map((it, i) => {
    let title = '', hot = null, url = '';
    if (it && it.target) { title = it.target.title || ''; hot = it.detail_text; url = `https://www.zhihu.com/question/${it.target.id || ''}`; }
    else if (it && (it.keyword !== undefined || it.show_name !== undefined)) { title = it.keyword || it.show_name || ''; hot = it.heat_score; url = it.uri || `https://search.bilibili.com/all?keyword=${encodeURIComponent(title)}`; }
    else { title = (it && (it.title || it.name || it.word)) || ''; hot = it ? (it.hot ?? it.heat ?? it.hotValue ?? it.heatValue) : null; url = (it && it.url) || ''; }
    return { rank: i + 1, title: String(title), heatValue: parseHeat(hot), heatText: hot != null ? formatHeat(hot, config.unit) : '—', url, isNew: false, category: categorize(String(title)) };
  });
}

async function fetchPlatform(key, config) {
  for (const url of config.urls) {
    try {
      const resp = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json,text/plain,*/*' }, signal: AbortSignal.timeout(12000) });
      if (!resp.ok) continue;
      const raw = await resp.json();
      const items = parseItems(raw, config);
      if (items.length > 0) { console.log(`[OK] ${key} <- ${url}`); return { name: config.name, unit: config.unit, list: items }; }
    } catch (e) { console.log(`[FAIL] ${key} <- ${url}: ${e.message}`); }
  }
  return null;
}

function computeOverall(platforms) {
  const map = new Map();
  for (const [key, pf] of Object.entries(platforms)) {
    for (const item of pf.list) {
      const t = item.title;
      if (!map.has(t)) map.set(t, { title: t, url: item.url || '', heatValue: 0, heatText: '—', platforms: [], category: item.category || '综合' });
      const e = map.get(t);
      if (!e.platforms.includes(key)) e.platforms.push(key);
      if ((item.heatValue || 0) > (e.heatValue || 0)) { e.heatValue = item.heatValue; e.heatText = item.heatText; if (item.url) e.url = item.url; }
    }
  }
  const arr = [...map.values()];
  arr.sort((a, b) => (b.heatValue || 0) - (a.heatValue || 0));
  return arr.slice(0, 10).map((item, i) => ({ rank: i + 1, title: item.title, url: item.url || '', heatText: item.heatText || '—', heatValue: item.heatValue || 0, platforms: item.platforms, category: item.category || '综合', cross: item.platforms.length > 1 }));
}

function computeFastest(platforms) {
  const map = new Map();
  for (const [key, pf] of Object.entries(platforms)) {
    for (const item of pf.list) {
      const t = item.title;
      if (!map.has(t)) map.set(t, { title: t, heatValue: 0, platforms: [] });
      const e = map.get(t);
      if (!e.platforms.includes(key)) e.platforms.push(key);
      if ((item.heatValue || 0) > (e.heatValue || 0)) e.heatValue = item.heatValue;
    }
  }
  const arr = [...map.values()];
  arr.sort((a, b) => (b.heatValue || 0) - (a.heatValue || 0));
  return arr.slice(0, 10).map((item, i) => ({ rank: i + 1, title: item.title, rate: item.heatValue > 500 ? '极速' : item.heatValue > 100 ? '爆发' : '飙升', platforms: item.platforms, cross: item.platforms.length > 1 }));
}

function categorizeAll(platforms) {
  const stats = {};
  for (const pf of Object.values(platforms)) for (const item of pf.list) stats[item.category] = (stats[item.category] || 0) + 1;
  return stats;
}

function platformHeatStats(platforms) {
  const stats = {};
  for (const [key, pf] of Object.entries(platforms)) stats[key] = pf.list.reduce((s, i) => s + (i.heatValue || 0), 0);
  return stats;
}

async function buildData(env) {
  const fetchPromises = Object.entries(SOURCES).map(async ([key, config]) => [key, await fetchPlatform(key, config)]);
  const settled = await Promise.allSettled(fetchPromises);
  const platformResults = {};
  for (const s of settled) { const [key, result] = s.value || [null, null]; if (key && result) platformResults[key] = result; }
  if (Object.keys(platformResults).length === 0) return null;

  const overall = computeOverall(platformResults);
  const fastest = computeFastest(platformResults);
  const categoryStats = categorizeAll(platformResults);
  const pstats = platformHeatStats(platformResults);
  const total = Object.values(platformResults).reduce((s, pf) => s + pf.list.length, 0);

  let newTopics = 0;
  const KV = env && env.HOT_DATA;
  if (KV) {
    try {
      const nowSec = Math.floor(Date.now() / 1000);
      const WINDOW = 24 * 3600;
      const seenRaw = (await KV.get('seen_topics', { type: 'json' })) || {};
      const seen = {};
      for (const [t, ts] of Object.entries(seenRaw)) if (nowSec - ts < WINDOW) seen[t] = ts;
      const titles = new Set();
      for (const pf of Object.values(platformResults)) for (const it of pf.list) titles.add(it.title);
      for (const t of titles) if (seen[t] === undefined) { seen[t] = nowSec; newTopics++; }
      await KV.put('seen_topics', JSON.stringify(seen), { expirationTtl: WINDOW + 7200 });
    } catch (e) { console.log('[seen FAIL] ' + e.message); }
  }

  if (KV) {
    try {
      const prev = await KV.get('prev_snapshot', { type: 'json' });
      if (prev) {
        const mark = (items, prevMap) => { if (!prevMap) return; for (const it of items) { const pr = prevMap[it.title]; if (pr === undefined) it.trend = { isNew: true, rankDelta: 0 }; else it.trend = { isNew: false, rankDelta: pr - it.rank }; } };
        mark(overall, prev.overall);
        for (const [key, pf] of Object.entries(platformResults)) if (prev.platforms && prev.platforms[key]) mark(pf.list, prev.platforms[key]);
      }
      const snap = { ts: Math.floor(Date.now() / 1000), overall: {}, platforms: {} };
      for (const it of overall) snap.overall[it.title] = it.rank;
      for (const [key, pf] of Object.entries(platformResults)) { snap.platforms[key] = {}; for (const it of pf.list) snap.platforms[key][it.title] = it.rank; }
      await KV.put('prev_snapshot', JSON.stringify(snap), { expirationTtl: 3 * 3600 });
    } catch (e) { console.log('[trend FAIL] ' + e.message); }
  }

  const now = new Date(Date.now() + 8 * 3600 * 1000);
  return {
    version: 'v2-8趋势搜索',
    updateTime: now.toISOString().slice(0, 16).replace('T', ' '),
    updateTimestamp: Math.floor(Date.now() / 1000),
    timeZone: 'Asia/Shanghai (UTC+8)',
    source: 'Cloudflare Worker 实时抓取（guiguiya 聚合）',
    summary: { totalTopics: total, platforms: Object.keys(platformResults).length, newTopics: newTopics },
    overall, platforms: platformResults, fastestGrowing: fastest, categoryStats, platformHeatStats: pstats,
  };
}

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json; charset=utf-8' };
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
    const url = new URL(request.url);
    const fresh = url.searchParams.get('fresh') === '1';
    const KEY = 'hotdata';
    const KV = env.HOT_DATA;
    let data = null;
    if (!fresh && KV) { try { data = await KV.get(KEY, { type: 'json' }); } catch (e) { console.log('[KV GET FAIL] ' + e.message); } }
    if (!data || fresh) {
      const built = await buildData(env);
      if (built) { data = built; if (KV) ctx.waitUntil(KV.put(KEY, JSON.stringify(data), { expirationTtl: 3600 })); }
      else if (!data && KV) { try { data = await KV.get(KEY, { type: 'json' }); } catch (e) {} }
    }
    if (!data) return new Response(JSON.stringify({ error: '数据暂不可用，请稍后重试' }), { status: 503, headers: corsHeaders });
    return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Cache-Control': 'no-store' } });
  },
  async scheduled(event, env, ctx) {
    const data = await buildData(env);
    if (data) { if (env.HOT_DATA) await env.HOT_DATA.put('hotdata', JSON.stringify(data), { expirationTtl: 3600 }); console.log('[CRON] 平台数: ' + data.summary.platforms + '，24h新增: ' + data.summary.newTopics); }
    else console.log('[CRON] 本次抓取全部失败，保留旧数据');
  },
};
