/**
 * 全网社交平台热点榜单 - Cloudflare Worker
 * 
 * 部署方式：
 * 1. 注册 Cloudflare 账号 (https://dash.cloudflare.com)
 * 2. 进入 Workers & Pages → Create → Create Worker
 * 3. 复制此文件全部内容粘贴到编辑器
 * 4. 点击 Deploy
 * 5. 获取 URL 如 https://hotlists.xxx.workers.dev
 * 6. 在 index.html 中将 WORKER_URL 改为你的 Worker URL
 * 
 * 免费额度：10万次请求/天，无时间/频率限制
 * Worker 会缓存数据 5 分钟，减少上游 API 压力
 */

// ============ 数据源配置 ============
const SOURCES = {
  weibo: {
    // guigui API，支持 CORS，返回 {data: [{title, hot, url, ...}]}
    urls: ['https://api.guiguiya.com/api/hotlist?type=weibo'],
    name: '微博热搜',
    unit: '万',
  },
  zhihu: {
    // 知乎官方 API，返回 {data: [{target: {title}, detail_text: "X 万热度", ...}]}
    urls: ['https://api.zhihu.com/topstory/hot-list?limit=10'],
    name: '知乎热榜',
    unit: '万',
    needsUA: true,
    isOfficial: true,
  },
  douyin: {
    urls: ['https://api.guiguiya.com/api/hotlist?type=douyin'],
    name: '抖音热点',
    unit: '万',
  },
  bilibili: {
    // B站官方 API，返回 {data: {trending: {list: [{keyword, heat_score, ...}]}}}
    urls: ['https://api.bilibili.com/x/web-interface/search/square?limit=10'],
    name: 'B站热搜',
    unit: '',
    needsUA: true,
    isOfficial: true,
  },
  xiaohongshu: {
    urls: ['https://api.guiguiya.com/api/hotlist?type=xiaohongshu'],
    name: '小红书热搜',
    unit: '万',
  },
};

// ============ 分类关键词 ============
const CATEGORY_KEYWORDS = {
  '科技': ['AI', '人工智能', '芯片', '半导体', '手机', '苹果', '华为', '小米', '科技', '互联网', '算法', '大模型', 'ChatGPT', '量子', '5G', '6G', '数码', '电动车', '新能源', '自动驾驶', '机器人', '百度', '腾讯', '阿里', '字节', 'OpenAI', '谷歌', '微软', '英伟达'],
  '社会': ['社会', '民生', '教育', '学校', '大学', '高考', '考研', '就业', '工资', '收入', '房价', '医保', '养老', '生育', '结婚', '离婚', '交通', '高铁', '地铁', '公交', '快递', '外卖', '城管', '物业', '社区'],
  '娱乐': ['娱乐', '明星', '演员', '歌手', '演唱会', '电影', '电视剧', '综艺', '选秀', '偶像', '粉丝', '娱乐圈', '影视', '音乐', '舞蹈', '说唱', '综艺', '真人秀', '选秀'],
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

// ============ 抓取单个平台 ============
async function fetchPlatform(key, config) {
  for (const url of config.urls) {
    try {
      const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
      const resp = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
      if (!resp.ok) continue;
      const raw = await resp.json();
      
      let items = [];
      if (config.isOfficial && key === 'zhihu') {
        // 知乎官方 API 格式
        items = (raw.data || []).slice(0, 10).map((item, i) => ({
          rank: i + 1,
          title: item.target?.title || '',
          heatValue: parseHeat(item.detail_text),
          heatText: item.detail_text || (parseHeat(item.detail_text) + '万'),
          url: `https://www.zhihu.com/question/${item.target?.id || ''}`,
          isNew: false,
          category: categorize(item.target?.title || ''),
        }));
      } else if (config.isOfficial && key === 'bilibili') {
        // B站官方 API 格式
        items = (raw.data?.trending?.list || []).slice(0, 10).map((item, i) => ({
          rank: i + 1,
          title: item.keyword || item.show_name || '',
          heatValue: item.heat_score || 0,
          heatText: item.heat_score ? (item.heat_score + '') : '—',
          url: item.uri || `https://search.bilibili.com/all?keyword=${encodeURIComponent(item.keyword || '')}`,
          isNew: false,
          category: categorize(item.keyword || ''),
        }));
      } else {
        // guigui API 格式
        items = (raw.data || []).slice(0, 10).map((item, i) => ({
          rank: i + 1,
          title: item.title || '',
          heatValue: parseHeat(item.hot),
          heatText: item.hot ? (item.hot + (config.unit || '')) : '—',
          url: item.url || '',
          isNew: false,
          category: categorize(item.title || ''),
        }));
      }
      
      if (items.length > 0) {
        return { name: config.name, unit: config.unit, list: items };
      }
    } catch (e) {
      console.log(`[FAIL] ${key}: ${e.message}`);
      continue;
    }
  }
  return null;
}

// ============ 聚合计算 ============
function computeOverall(platforms) {
  const all = [];
  for (const [key, pf] of Object.entries(platforms)) {
    for (const item of pf.list) {
      all.push({ ...item, platforms: [key], platform: key, platformName: pf.name });
    }
  }
  all.sort((a, b) => (b.heatValue||0) - (a.heatValue||0));
  return all.slice(0, 10).map((item, i) => ({
    rank: i + 1,
    title: item.title,
    heatText: item.heatText || '—',
    heatValue: item.heatValue || 0,
    platforms: item.platforms || [],
    category: item.category || '综合',
    desc: item.heatText || '',
  }));
}

function computeFastest(platforms, overall) {
  const all = [];
  for (const [key, pf] of Object.entries(platforms)) {
    for (const item of pf.list) {
      const growth = item.heatValue || 0;
      all.push({ ...item, platforms: [key], platform: key, platformName: pf.name, growthValue: growth });
    }
  }
  all.sort((a, b) => (b.growthValue||0) - (a.growthValue||0));
  return all.slice(0, 10).map((item, i) => ({
    rank: i + 1,
    title: item.title,
    rate: item.growthValue > 500 ? '极速' : item.growthValue > 100 ? '爆发' : '飙升',
    platforms: item.platforms || [],
    desc: item.heatText || (item.platformName + ' ' + item.heatText),
  }));
}

function categorizeAll(platforms, overall) {
  const stats = {};
  for (const [key, pf] of Object.entries(platforms)) {
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

// ============ 主处理函数 ============
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

    // 检查缓存（5 分钟）
    const cache = caches.default;
    const cacheKey = new Request('https://hotlists.internal.cache/data.json');
    const cached = await cache.match(cacheKey);
    if (cached) {
      const resp = new Response(cached.body, { headers: { ...corsHeaders, 'X-Cache': 'HIT' } });
      return resp;
    }

    // 并发抓取所有平台
    const platformResults = {};
    const fetchPromises = Object.entries(SOURCES).map(async ([key, config]) => {
      const result = await fetchPlatform(key, config);
      return [key, result];
    });
    const settled = await Promise.allSettled(fetchPromises);
    
    for (const [key, result] of settled.map(s => s.value || [null, null])) {
      if (key && result) {
        platformResults[key] = result;
      }
    }

    // 计算聚合数据
    const overall = computeOverall(platformResults);
    const fastest = computeFastest(platformResults, overall);
    const categoryStats = categorizeAll(platformResults, overall);
    const pstats = platformHeatStats(platformResults);
    const total = Object.values(platformResults).reduce((s, pf) => s + pf.list.length, 0);

    const now = new Date(Date.now() + 8 * 3600 * 1000); // 北京时间
    const result = {
      updateTime: now.toISOString().slice(0, 16).replace('T', ' '),
      updateTimestamp: Math.floor(Date.now() / 1000),
      timeZone: 'Asia/Shanghai (UTC+8)',
      source: 'Cloudflare Worker 实时抓取（guigui API + 知乎/B站官方 API）',
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

    const response = new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'X-Cache': 'MISS', 'Cache-Control': 'public, max-age=300' },
    });

    // 写入缓存（5 分钟过期）
    ctx.waitUntil(cache.put(cacheKey, response.clone()));

    return response;
  },
};