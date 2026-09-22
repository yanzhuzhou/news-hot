# 全网社交平台热点榜单

> 聚合微博、小红书、知乎、抖音、B站五大平台实时热点，呈现跨平台综合十大、分平台各十大及24小时热度增长最快十大，附带数据分析看板。对应网页链接：https://yanzhuzhou.github.io/news-hot/

## 数据更新机制

通过 **Cloudflare Worker** 实时抓取数据，浏览器端直接调用，**无时间/次数限制**，免费额度 10 万次/天。

- 页面加载时自动抓取最新数据
- 点击右上角刷新按钮立即更新
- 每 5 分钟自动刷新一次
- Worker 内置 5 分钟缓存，减少上游 API 压力
- Worker 不可用时自动回退到本地缓存 `data.json`

## 部署 Cloudflare Worker（免费，约 5 分钟）

1. 注册 [Cloudflare 账号](https://dash.cloudflare.com)（已有账号跳过）
2. 进入 **Workers & Pages** → 选择已有 Worker 或创建新的
3. 点击 **Edit code**，将 `worker.js` 文件的全部内容粘贴到编辑器
4. 点击 **Deploy**
5. 复制 Worker URL
6. 编辑 `index.html`，找到 `const WORKER_URL`，改为你的 Worker URL
7. 提交代码到 GitHub，完成！

> **免费额度**：10 万次请求/天，Worker 内置 5 分钟缓存，实际上游 API 调用量极低。

## 部署到 GitHub Pages

1. 将所有文件推送到 GitHub 仓库
2. 在仓库 **Settings → Pages** 中选择 **Deploy from branch**，选择 `main` 分支
3. 等待几分钟后，访问 `https://<username>.github.io/<repo-name>/` 即可

## 内容结构

| 模块 | 说明 |
|------|------|
| 数据总览 | KPI 卡片展示累计话题数、覆盖平台数、最高热度值、24h新增话题数 |
| 热点数据分析 | 各平台最高热度对比柱状图 + 话题类别分布环形图 + 数据洞察 |
| 跨平台综合十大热点 | 按全网综合热度排序，标注来源平台与热度值 |
| 分平台十大热点 | 微博、知乎、抖音、B站、小红书各自榜单，可切换 |
| 24小时增长最快十大 | 对比昨日同时段，识别突发飙升热点 |

## 文件说明

| 文件 | 说明 |
|------|------|
| `index.html` | 自包含的热点榜单网页，从 Worker 实时获取数据 |
| `worker.js` | Cloudflare Worker 脚本，浏览器端实时抓取数据 |
| `data.json` | 静态缓存数据，Worker 不可用时的 fallback |
| `fetch_hotlists.py` | Python 抓取脚本，可手动运行生成 data.json |
| `README.md` | 本说明文件 |

## 数据来源

| 平台 | API 来源 |
|------|----------|
| 微博 | guigui API（支持 CORS） |
| 知乎 | 知乎官方 API（api.zhihu.com） |
| 抖音 | guigui API |
| B站 | B站官方 API（api.bilibili.com） |
| 小红书 | guigui API（可用时） / 缓存数据 |

## 热度口径说明

各平台热度统计口径不同，跨平台对比仅供参考：

- **微博**：万热度
- **知乎**：万热度
- **抖音**：万热度值
- **B站**：热度分数
- **小红书**：万

## 本地预览

```bash
python3 -m http.server 8000
# 访问 http://localhost:8000
```

## 数据说明与免责

- 本榜单为抓取时刻的快照数据，热度值随时间实时变化。
- 数据仅用于趋势观察与信息聚合，不代表任何官方观点。
- 各平台热榜接口可能随时调整，如数据缺失属正常现象。
- 所有数据源为公开免费 API，不涉及任何登录或私有数据。
