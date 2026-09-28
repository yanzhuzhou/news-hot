/**
 * 全网社交平台热点榜单 - Cloudflare Worker（纯 Cloudflare 版）
 *
 * 架构：完全不依赖 GitHub。
 *  - 自动更新：Cloudflare Cron Trigger 每 5 分钟后台抓取并写入 KV（无人访问也更新）
 *  - 手动刷新：前端按钮请求 ?fresh=1，Worker 强制实时抓取并更新 KV
 *  - 正常访问：直接从 KV 读取最新缓存返回（由 Cron 维护，永远不超过 5 分钟旧）
 *
 * 依赖：
 *  - KV 命名空间，绑定变量名 HOT_DATA（在 wrangler.toml 或控制台配置）
 *  - Cron Trigger：每 5 分钟触发一次（在 wrangler.toml 或控制台配置，cron 设为每 5 分钟）
 *
 * 部署：wrangler deploy（需先创建 KV 并填 id），或在控制台粘贴代码 + 绑定 KV + 加 Cron。
 * 免费额度：10 万次请求/天；KV 免费 1GB。
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// ============ 数据源配置（多备用源，按顺序尝试）============
const SOURCES = {
  weibo: {
    name: '微博热搜', unit: '万',
    urls: [
      'https://api.vvhan.com/api/hotlist?type=weibo',
      'https://api.guiguiya.com/api/hotlist?type=weibo',
      'https://tenapi.cn/v2/hotlist?type=weibo',
    ],
  },
  zhihu: {
    name: '知乎热榜', unit: '万',
    urls: [
      'https://api.vvhan.com/api/hotlist?type=zhihu',
      'https://api.guiguiya.com/api/hotlist?type=zhihu',
      'https://tenapi.cn/v2/hotlist?type=zhihu',
    ],
  },
  douyin: {
    name: '抖音热点', unit: '万',
    urls: [
      'https://api.vvhan.com/api/hotlist?type=douyin',
      'https://api.guiguiya.com/api/hotlist?type=douyin',
      'https://tenapi.cn/v2/hotlist?type=douyin',
    ],
  },
  bilibili: {
    name: 'B站热搜', unit: '',
    urls: [
      'https://api.vvhan.com/api/hotlist?type=bilibili',
      'https://api.guiguiya.com/api/hotlist?type=bilibili',
      'https://tenapi.cn/v2/hotlist?type=bilibili',
    ],
  },
  xiaohongshu: {
    name: '小红书热搜', unit: '万',
    urls: [
      'https://api.vvhan.com/api/hotlist?type=xiaohongshu',
      'https://api.vvhan.com/api/hotlist?type=xhs',
      'https://tenapi.cn/v2/hotlist?type=xiaohongshu',
    ],
  },
};

// ============ 分类关键词 ============
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
    for (const kw of keywords) {
      if (title.includes(kw)) return cat;
    }
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

function formatHeat(s, unit) {
  if (!s) return '—';
  return String(s) + (unit || '');
}

// ============ 解析多种 API 返回格式（兼容 vvhan/guigui/tenapi/官方）============
function normalizeList(raw) {
  if (!raw || typeof raw !== 'object') return null;
  // vvhan: { code, data: { name, data: [...] } }  ← 真实列表在 data.data
  if (raw.data && Array.isArray(raw.data.data)) return raw.data.data;
  // 通用聚合: { data: [...] } 或 直接就是数组
  if (Array.isArray(raw.data)) return raw.data;
  if (Array.isArray(raw)) return raw;
  // 知乎官方: { data: [{ target: { title, id }, detail_text }] }
  if (Array.isArray(raw.data) && raw.data[0] && raw.data[0].target) return raw.data;
  // B站官方: { data: { trending: { list: [...] } } }
  if (raw.data && raw.data.trending && Array.isArray(raw.data.trending.list)) return raw.data.trending.list;
  return null;
}

function parseItems(raw, config) {
  const list = normalizeList(raw);
  if (!list || !list.length) return [];
  return list.slice(0, 10).map((it, i) => {
    let title = '', hot = null, url = '';
    if (it && it.target) {                          // 知乎
      title = it.target.title || '';
      hot = it.detail_text;
      url = `https://www.zhihu.com/question/${it.target.id || ''}`;
    } else if (it && (it.keyword !== undefined || it.show_name !== undefined)) { // B站
      title = it.keyword || it.show_name || '';
      hot = it.heat_score;
      url = it.uri || `https://search.bilibili.com/all?keyword=${encodeURIComponent(title)}`;
    } else {                                        // 通用聚合（vvhan/guigui/tenapi）
      title = (it && (it.title || it.name || it.word)) || '';
      hot = it ? (it.hot ?? it.heat ?? it.hotValue ?? it.heatValue) : null;
      url = (it && it.url) || '';
    }
    return {
      rank: i + 1,
      title: String(title),
      heatValue: parseHeat(hot),
      heatText: hot != null ? formatHeat(hot, config.unit) : '—',
      url,
      isNew: false,
      category: categorize(String(title)),
    };
  });
}

// ============ 抓取单个平台（多备用源）============
async function fetchPlatform(key, config) {
  for (const url of config.urls) {
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept': 'application/json,text/plain,*/*' },
        signal: AbortSignal.timeout(12000),
      });
      if (!resp.ok) continue;
      const raw = await resp.json();
      const items = parseItems(raw, config);
      if (items.length > 0) {
        console.log(`[OK] ${key} <- ${url}`);
        return { name: config.name, unit: config.unit, list: items };
      }
    } catch (e) {
      console.log(`[FAIL] ${key} <- ${url}: ${e.message}`);
    }
  }
  return null;
}

// ============ 聚合计算 ============
function computeOverall(platforms) {
  const all = [];
  for (const [key, pf] of Object.entries(platforms)) {
    for (const item of pf.list) {
      all.push({ ...item, platform: key, platformName: pf.name });
    }
  }
  all.sort((a, b) => (b.heatValue || 0) - (a.heatValue || 0));
  return all.slice(0, 10).map((item, i) => ({
    rank: i + 1,
    title: item.title,
    url: item.url || '',
    heatText: item.heatText || '—',
    heatValue: item.heatValue || 0,
    platforms: [item.platform],
    platformName: item.platformName,
    category: item.category || '综合',
    desc: item.heatText || '',
  }));
}

function computeFastest(platforms) {
  const all = [];
  for (const [key, pf] of Object.entries(platforms)) {
    for (const item of pf.list) {
      all.push({ ...item, platform: key, platformName: pf.name });
    }
  }
  all.sort((a, b) => (b.heatValue || 0) - (a.heatValue || 0));
  return all.slice(0, 10).map((item, i) => ({
    rank: i + 1,
    title: item.title,
    rate: item.heatValue > 500 ? '极速' : item.heatValue > 100 ? '爆发' : '飙升',
    platforms: [item.platform],
    platformName: item.platformName,
    desc: (item.platformName || '') + ' ' + (item.heatText || ''),
  }));
}

function categorizeAll(platforms) {
  const stats = {};
  for (const pf of Object.values(platforms)) {
    for (const item of pf.list) {
      stats[item.category] = (stats[item.category] || 0) + 1;
    }
  }
  return stats;
}

function platformHeatStats(platforms) {
  const stats = {};
  for (const [key, pf] of Object.entries(platforms)) {
    stats[key] = pf.list.reduce((s, i) => s + (i.heatValue || 0), 0);
  }
  return stats;
}

// ============ 抓取 + 聚合，返回完整结果；全部失败返回 null ============
async function buildData() {
  const fetchPromises = Object.entries(SOURCES).map(async ([key, config]) => {
    const result = await fetchPlatform(key, config);
    return [key, result];
  });
  const settled = await Promise.allSettled(fetchPromises);
  const platformResults = {};
  for (const s of settled) {
    const [key, result] = s.value || [null, null];
    if (key && result) platformResults[key] = result;
  }
  if (Object.keys(platformResults).length === 0) return null; // 全部失败

  const overall = computeOverall(platformResults);
  const fastest = computeFastest(platformResults);
  const categoryStats = categorizeAll(platformResults);
  const pstats = platformHeatStats(platformResults);
  const total = Object.values(platformResults).reduce((s, pf) => s + pf.list.length, 0);

  const now = new Date(Date.now() + 8 * 3600 * 1000); // 北京时间
  return {
    updateTime: now.toISOString().slice(0, 16).replace('T', ' '),
    updateTimestamp: Math.floor(Date.now() / 1000),
    timeZone: 'Asia/Shanghai (UTC+8)',
    source: 'Cloudflare Worker 实时抓取（vvhan/guigui/tenapi 聚合）',
    summary: {
      totalTopics: total,
      platforms: Object.keys(platformResults).length,
      newTopics: 0,
    },
    overall,
    platforms: platformResults,
    fastestGrowing: fastest,
    categoryStats,
    platformHeatStats: pstats,
  };
}

// ============ 主入口 ============
export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json; charset=utf-8',
    };
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const fresh = url.searchParams.get('fresh') === '1'; // 手动强制刷新
    const KEY = 'hotdata';

    // 正常访问：直接读 KV 缓存（由 Cron 维护）
    let data = null;
    if (!fresh) {
      try { data = await env.HOT_DATA.get(KEY, { type: 'json' }); } catch (e) { console.log('[KV GET FAIL] ' + e.message); }
    }

    // KV 为空 或 强制刷新 → 实时抓取并写回 KV
    if (!data || fresh) {
      const built = await buildData();
      if (built) {
        data = built;
        ctx.waitUntil(env.HOT_DATA.put(KEY, JSON.stringify(data), { expirationTtl: 3600 }));
      } else if (!data) {
        // 实时全失败且 KV 也无 → 再读一次 KV（可能有旧数据）
        try { data = await env.HOT_DATA.get(KEY, { type: 'json' }); } catch (e) {}
      }
    }

    if (!data) {
      return new Response(JSON.stringify({ error: '数据暂不可用，请稍后重试' }), { status: 503, headers: corsHeaders });
    }
    return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Cache-Control': 'no-store' } });
  },

  // Cron Trigger 后台定时抓取（无人访问也更新）
  async scheduled(event, env, ctx) {
    const data = await buildData();
    if (data) {
      await env.HOT_DATA.put('hotdata', JSON.stringify(data), { expirationTtl: 3600 });
      console.log('[CRON] 数据已更新，平台数: ' + data.summary.platforms);
    } else {
      console.log('[CRON] 本次抓取全部失败，保留旧数据');
    }
  },
};
