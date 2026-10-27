// v1.8.0 Step Plan 客户端 UI 回归。
// 覆盖三条线: 状态条 chip (planBarText / 档位 / 开关)、看板详情卡 (DashboardDrawer)、设置开关接线。
// ⚠️ 这些函数是**纯函数/纯渲染**, 不碰网络; 只有 SettingsModal 的开关接线需要伪造 fetch。
// ⚠️ 测试只读仓库内文件 + os.tmpdir() 夹具, 不读运行机的私有文件(AGENTS.md 铁律 8)。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const source = fs.readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')
// 源码里读一次再统一成 LF: 工作区可能被 core.autocrlf 检出成 CRLF, 跨行正则会假阴性。
const lf = (s) => s.replace(/\r\n/g, '\n')

const element = () => ({ style: { setProperty(k, v) { this[k] = v }, removeProperty() {} },
  classList: { add() {}, remove() {}, contains: () => false }, dataset: {}, children: [],
  setAttribute(k, v) { this[k] = v }, appendChild(n) { this.children.push(n); n.parentNode = this },
  removeChild(n) { this.children = this.children.filter(c => c !== n) },
  addEventListener() {}, removeEventListener() {}, contains: () => false,
  getBoundingClientRect: () => ({ left: 20, top: 40, bottom: 60, width: 90, height: 90 }), offsetWidth: 90, offsetHeight: 90 })
const doc = { body: element(), head: element(), documentElement: element(), createElement: element,
  querySelector: () => ({}), getElementById: () => null, addEventListener() {}, removeEventListener() {}, hidden: false }
const react = { createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(x => x !== null && x !== false && x !== undefined) }),
  useState: v => [v, () => {}], useRef: v => ({ current: v }), useEffect() {}, useCallback: f => f, useSyncExternalStore: (s, g) => g() }
let captured
const window = { innerWidth: 360, innerHeight: 754, addEventListener() {}, removeEventListener() {},
  __ModuleLoader__: { load({ factory }) { captured = factory(name => name === 'react' ? react : name === 'react-dom' ? { createPortal: (node, target) => ({ node, target }) } : {}) } } }
const fetch = async () => ({ ok: true, json: async () => ({ ok: true }) })

// 把内部函数提到 exports 上(与 test-v170-ui-fixes.mjs 同一招)。snapshot 是工厂级变量。
const instrumented = source.replace('    exports.apply = apply;',
  '    exports.__test = { planBarText, planLevel, planPct, planPct2, roundHalfUp2, BarReadout, PlatformDetail, SettingsModal, setSnapshot: v => { snapshot = v } };\n    exports.apply = apply;')
assert.ok(instrumented !== source, '没找到 exports.apply 注入点 —— client.js 结构变了, 先更新本测试')
new Function('window', 'document', 'navigator', 'localStorage', 'fetch', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'Audio', instrumented)(
  window, doc, {}, { getItem: () => '', setItem() {} }, fetch, fn => fn, () => {}, fn => { fn(); return 1 }, () => {}, class { play() { return Promise.resolve() } })
const T = captured.__test
const t = (k, vars) => { const zh = { 'plan.unlimited': '不限量', 'plan.left': '剩 {p}%', 'plan.used': '已用 {p}%', 'plan.usedM': '用 {n}M', 'plan.title': 'Step Plan 订阅套餐', 'plan.none': '该 Key 暂无订阅套餐', 'plan.unavailable': '套餐用量暂不可查（{r}）', 'plan.unlimitedLeft': '不限量', 'plan.credits': '{n}M credits', 'plan.resetAt': '{t} 重置', 'plan.expiresAt': '{d} 到期', 'plan.fiveHour': '5 小时窗口', 'plan.weekly': '周配额', 'plan.monthly': '月度配额', 'plan.bucketTotal': '套餐总额度', 'plan.bucketSub': '订阅额度', 'plan.bucketTopup': '加油包额度', 'plan.window': '限流窗口', 'plan.bucket': '额度桶', 'plan.remaining': '剩余', 'plan.total': '总额', 'plan.partial': '部分套餐数据缺失，以下为已查到的部分', 'settings.showPlan': '状态条显示套餐用量', 'settings.showPlanHint': '阶跃星辰等订阅套餐平台：在状态条余额后面追加一段套餐用量（如「用 11.22M 剩 22.33%」）。关掉后仍可在看板详情里查看。', 'settings.showCost': '状态条显示本会话消耗', 'settings.showCostHint': '在状态条末尾追加「~¥33.07」这段本会话消耗。默认关闭；关掉后看板详情里仍能看到完整的分模型/分币种消耗。' }
  let s = zh[k] ?? k; if (vars) for (const [k2, v] of Object.entries(vars)) s = s.replace('{' + k2 + '}', String(v)); return s }
const flatten = n => n && typeof n === 'object' ? [n, ...(n.children || []).flatMap(flatten)] : []
// 默认夹具带 usedM, 对应「用 11.22M 剩 22.33%」这类两段格式; 窗口族没有 usedM, 只剩百分比段。
const planView = (over = {}) => ({ kind: 'active', primary: { kind: 'window', key: 'five_hour', label: '5 小时窗口', leftPercent: 42, unlimited: false }, rows: [], quotaState: 'full', ...over })

let fail = 0
const check = (name, fn) => { try { fn() } catch (e) { fail++; console.log('FAIL: ' + name + ' → ' + e.message) } }

// ---------- A. planBarText: 状态条 chip ----------
check('A1 有套餐 → 用 11.22M 剩 22.33% (两位小数, 无「套餐」前缀)', () => {
  assert.equal(T.planBarText(planView({ usedM: 11.22, primary: { kind: 'window', key: 'five_hour', leftPercent: 22.33, unlimited: false } }), t).text, '用 11.22M 剩 22.33%')
  assert.equal(T.planBarText(planView({ usedM: 11.22 }), t).text, '用 11.22M 剩 42.00%')
})
check('A1b 四舍五入到两位小数 (half-up, 不是二进制就近取舍)', () => {
  assert.equal(T.roundHalfUp2(2.675), 2.68, '2.675 实际存成 2.67499999…, 直接 toFixed 会得 2.67')
  assert.equal((2.675).toFixed(2), '2.67', '钉子: 证明 toFixed 自身就近取舍, 所以 M 数必须先 roundHalfUp2')
  assert.equal(T.roundHalfUp2(2.665), 2.67)
  assert.equal(T.roundHalfUp2(0.125), 0.13)
  assert.equal(T.roundHalfUp2(0), 0)
  assert.equal(T.roundHalfUp2(-0.125), -0.13, '负数按绝对值 half-up, 不因 sign 变 NaN')
  assert.equal(T.roundHalfUp2(-2.5), -2.5)
  assert.equal(T.planPct2(42), '42.00')
  assert.equal(T.planPct2(null), null)
  assert.equal(T.planPct2(NaN), null)
  assert.equal(T.planBarText(planView({ usedM: 2.675, primary: { kind: 'window', key: 'five_hour', leftPercent: 2.665, unlimited: false } }), t).text, '用 2.68M 剩 2.67%')
})
check('A1c 窗口族没有 M 总量 → 只剩百分比段, 不补 0', () => {
  assert.equal(T.planBarText(planView(), t).text, '剩 42.00%', '没有 usedM 时不得显示「用 0.00M」')
  assert.equal(T.planBarText(planView({ usedM: 0 }), t).text, '用 0.00M 剩 42.00%', '真实 0 与「查不到」是两回事')
})
check('A2 档位与 getLevel 同一把尺子 (safe 50 / warn 10)', () => {
  assert.equal(T.planBarText(planView(), t).level, 'warn', '42% 落在 10<v<=50 → 黄')
  assert.equal(T.planBarText(planView({ primary: { kind: 'window', key: 'five_hour', leftPercent: 80, unlimited: false } }), t).level, 'ok')
  assert.equal(T.planBarText(planView({ primary: { kind: 'window', key: 'five_hour', leftPercent: 5, unlimited: false } }), t).level, 'err')
  assert.equal(T.planLevel(planView(), { safeThreshold: 50, warnThreshold: 10 }), 'warn')
  assert.equal(T.planLevel(planView(), { safeThreshold: 40, warnThreshold: 10 }), 'ok', '阈值取自配置, 不是硬编码')
})
check('A3 不限量 → 不限量', () => {
  assert.equal(T.planBarText(planView({ primary: { kind: 'window', key: 'five_hour', leftPercent: null, unlimited: true } }), t).text, '不限量')
  assert.equal(T.planBarText(planView({ primary: { kind: 'window', key: 'five_hour', leftPercent: null, unlimited: true } }), t).level, 'ok')
})
check('A4 查不到百分比 ≠ 不限量 (红线: 不把「未知」伪装成「不限量」)', () => {
  const r = T.planBarText(planView({ primary: { kind: 'window', key: 'five_hour', leftPercent: null, unlimited: false } }), t)
  assert.equal(r.text, '—')
  assert.equal(r.level, null, '百分比未知时不上色')
})
check('A5 无套餐 / 不可查 / 无视图 → 不占位 (null)', () => {
  assert.equal(T.planBarText(null, t), null)
  assert.equal(T.planBarText({ kind: 'none' }, t), null)
  assert.equal(T.planBarText({ kind: 'unavailable', reason: 'no-key' }, t), null)
  assert.equal(T.planBarText(planView({ primary: null }), t), null)
})
check('A6 title 带窗口明细, 不只是一个百分比', () => {
  const r = T.planBarText(planView({ planName: 'step-plan', rows: [{ kind: 'window', key: 'five_hour', label: '5 小时窗口', leftPercent: 42, totalM: 100, remainingM: 42, unlimited: false }] }), t)
  assert.match(r.title, /Step Plan 订阅套餐/)
  assert.match(r.title, /剩 42.00%/)
  assert.match(r.title, /已用 58.00%/)
  assert.match(r.title, /5 小时窗口/)
})
check('A7 planPct 只接受有限数', () => {
  assert.equal(T.planPct(42.4), 42); assert.equal(T.planPct(42.6), 43)
  assert.equal(T.planPct(null), null); assert.equal(T.planPct(undefined), null)
  assert.equal(T.planPct(NaN), null); assert.equal(T.planPct(Infinity), null)
  assert.equal(T.planPct('42'), null, '字符串不算 —— 服务端已挡, 这里是双保险')
})
check('A8 planPct2 两位 half-up, 且不吃浮点误差', () => {
  // 服务端 stepfunLeft 给的是全精度 (100-1.33=98.67), 显示层一次砍到位
  assert.equal(T.planPct2(42), '42.00')
  assert.equal(T.planPct2(98.67), '98.67')
  assert.equal(T.planPct2(97.64), '97.64', '真机案例: 97.64 曾被 1 位小数砍成 97.60')
  assert.equal(T.planPct2(99.113333333), '99.11')
  assert.equal(T.planPct2(99.115), '99.12', 'half-up 不是 half-even')
  assert.equal(T.planPct2(2.675), '2.68', '二进制浮点就近取舍的经典坑')
  assert.equal(T.planPct2(0), '0.00')
  assert.equal(T.planPct2(null), null); assert.equal(T.planPct2(undefined), null)
  assert.equal(T.planPct2(NaN), null); assert.equal(T.planPct2('42'), null)
})

// ---------- B. 状态条渲染: 开关 + 不占位 ----------
const barSnapshot = (plan, config = {}) => ({ status: 'ok', config: { safeThreshold: 50, warnThreshold: 10, ...config }, fetchedAt: 1,
  balances: [{ id: 'p1', platform: 'stepfun', category: '国内', status: 'ok', amount: 10, amountText: '¥10', planView: plan }] })
const renderBar = (plan, config) => {
  T.setSnapshot(barSnapshot(plan, config))
  const node = T.BarReadout({ t, onOpen() {}, onOpenSettings() {}, selectedId: 'p1', onSelect() {}, config: { safeThreshold: 50, warnThreshold: 10, ...config }, cost: null, provider: null, peakValley: false })
  return flatten(node)
}
check('B1 默认(showPlan 未设)显示套餐用量 chip', () => {
  const nodes = renderBar(planView({ usedM: 11.22 }))
  const chip = nodes.find(n => n.props && typeof n.props.className === 'string' && n.props.className.startsWith('dshadb_bar_plan'))
  assert.ok(chip, '状态条要有 dshadb_bar_plan 节点')
  assert.equal(chip.children[0], '用 11.22M 剩 42.00%')
})
check('B2 showPlan:false → 不渲染 chip (数据仍在, 只是不占状态条)', () => {
  const nodes = renderBar(planView(), { showPlan: false })
  assert.ok(!nodes.some(n => n.props && typeof n.props.className === 'string' && n.props.className.startsWith('dshadb_bar_plan')), '关掉后状态条不得出现套餐 chip')
})
check('B3 无套餐 → 不渲染 chip (不显示空壳)', () => {
  assert.ok(!renderBar(null).some(n => n.props && typeof n.props.className === 'string' && n.props.className.startsWith('dshadb_bar_plan')))
  assert.ok(!renderBar({ kind: 'none' }).some(n => n.props && typeof n.props.className === 'string' && n.props.className.startsWith('dshadb_bar_plan')))
})
check('B4 不可查时同样不占位', () => {
  assert.ok(!renderBar({ kind: 'unavailable', reason: 'forbidden' }).some(n => n.props && typeof n.props.className === 'string' && n.props.className.startsWith('dshadb_bar_plan')))
})
// v1.8.0: 「本会话消耗」尾巴 —— 维护者要求「删除掉, 要不然配置成一个开关」。默认关。
const costNode = (nodes) => nodes.find(n => n.props && n.props.className === 'dshadb_bar_cost')
const renderBarWithCost = (config) => {
  T.setSnapshot(barSnapshot(planView(), config))
  return flatten(T.BarReadout({ t, onOpen() {}, onOpenSettings() {}, selectedId: 'p1', onSelect() {},
    config: { safeThreshold: 50, warnThreshold: 10, ...config }, cost: { text: '~¥47.27', title: '本轮会话消耗 ¥47.27' }, provider: null, peakValley: false }))
}
check('B5 默认(showSessionCost 未设)不渲染「本会话消耗」尾巴', () => {
  assert.ok(!costNode(renderBarWithCost({})), '默认关: 哪怕有 cost 数据也不得占状态条')
})
check('B6 showSessionCost:true → 尾巴出现在状态条末尾', () => {
  const node = costNode(renderBarWithCost({ showSessionCost: true }))
  assert.ok(node, '开了开关却没有尾巴')
  assert.equal(node.children[0], '~¥47.27')
  assert.equal(node.props.title, '本轮会话消耗 ¥47.27')
})
check('B7 showSessionCost:false → 尾巴整段消失(不是留个空 span)', () => {
  assert.ok(!costNode(renderBarWithCost({ showSessionCost: false })))
})

// ---------- C. 看板详情卡 (套餐卡在 PlatformDetail 里, 不在 DashboardDrawer) ----------
const detail = (plan, config = {}) => {
  T.setSnapshot({ status: 'ok', config: { safeThreshold: 50, warnThreshold: 10, ...config }, fetchedAt: 1,
    balances: [{ id: 'p1', platform: 'stepfun', category: '国内', status: 'ok', amount: 1, amountText: '¥1', planView: plan }] })
  return flatten(T.PlatformDetail({ isOpen: true, onClose() {}, platformId: 'stepfun', t, config: { safeThreshold: 50, warnThreshold: 10, ...config } }).node)
}
check('C1 有 planView → 渲染套餐卡 + 进度条', () => {
  const nodes = detail(planView({ rows: [{ kind: 'window', key: 'five_hour', label: '5 小时窗口', leftPercent: 42, totalM: 100, remainingM: 42, unlimited: false }] }))
  assert.ok(nodes.some(n => n.props && typeof n.props.className === 'string' && n.props.className.startsWith('dshadb_planrow')), '每行一个窗口/额度桶')
  assert.ok(nodes.some(n => n.props && typeof n.props.className === 'string' && n.props.className.startsWith('dshadb_planbar_fill')), '进度条')
  assert.ok(nodes.some(n => n.props && typeof n.props.className === 'string' && n.props.className.startsWith('dshadb_planrow_val')), '剩余百分比文字')
})
check('C2 无 planView → 不渲染套餐卡', () => {
  assert.ok(!detail(null).some(n => n.props && typeof n.props.className === 'string' && n.props.className.startsWith('dshadb_planrow')))
})
check('C3 进度条宽度按剩余%夹在 0..100', () => {
  const mk = (leftPercent) => detail(planView({ rows: [{ kind: 'window', key: 'five_hour', leftPercent, unlimited: false }] }))
    .find(n => n.props && typeof n.props.className === 'string' && n.props.className.startsWith('dshadb_planbar_fill'))
  assert.equal(mk(-20).props.style.width, '0%')
  assert.equal(mk(42).props.style.width, '42%')
  assert.equal(mk(180).props.style.width, '100%')
})
check('C3b 详情卡 credits 也是两位小数 (与状态条同一口径)', () => {
  const nodes = detail(planView({ rows: [{ kind: 'bucket', key: 'subscription', leftPercent: 42, totalM: 2.675, remainingM: 1.115, unlimited: false }] }))
  const texts = nodes.map(n => n.children || []).flat().filter(x => typeof x === 'string')
  assert.ok(texts.some(x => x.includes('2.68M credits')), '总额 2.675 → 2.68M (half-up), 实际: ' + JSON.stringify(texts))
  assert.ok(texts.some(x => x.includes('1.12M credits')), '剩余 1.115 → 1.12M')
  const val = nodes.find(n => n.props && n.props.className === 'dshadb_planrow_val')
  assert.equal(val.children[0], '剩 42.00%', '详情卡百分比同样两位小数')
})
check('C4 不限量行 → 满条 + 文案「不限量」, 不显示百分比', () => {
  const nodes = detail(planView({ rows: [{ kind: 'window', key: 'five_hour', leftPercent: null, unlimited: true }] }))
  const fill = nodes.find(n => n.props && typeof n.props.className === 'string' && n.props.className.startsWith('dshadb_planbar_fill'))
  assert.equal(fill.props.style.width, '100%')
  assert.match(fill.props.className, /is_unknown/)
  const val = nodes.find(n => n.props && typeof n.props.className === 'string' && n.props.className.startsWith('dshadb_planrow_val'))
  assert.equal(val.children[0], '不限量')
})
check('C5 kind:none / unavailable 在看板里有说明, 不是空白卡', () => {
  for (const [view, needle] of [[{ kind: 'none' }, '该 Key 暂无订阅套餐'], [{ kind: 'unavailable', reason: 'forbidden' }, '套餐用量暂不可查']]) {
    const text = detail(view).map(n => n.children || []).flat().join('|')
    assert.ok(text.includes(needle), '缺少说明: ' + needle)
  }
})

// ---------- D. 设置开关接线 ----------
// ⚠️ 假 React 的 createElement **不会渲染函数组件**, 所以 Switch 在树里还是「type=函数」的元素,
//    只能断言它的 props(与 test-bar.mjs 同款限制)。
const planSwitch = (config) => {
  const nodes = flatten(T.SettingsModal({ isOpen: true, onClose() {}, t, config }).node)
  const row = nodes.find(n => n.props && n.props.key === 'planbar')
  assert.ok(row, '缺套餐开关行')
  const sw = row.children.find(c => typeof c.type === 'function' && c.props && typeof c.props.onChange === 'function')
  assert.ok(sw, '套餐行里没有 Switch')
  return sw
}
check('D1 设置面板有「状态条显示套餐用量」开关', () => {
  const nodes = flatten(T.SettingsModal({ isOpen: true, onClose() {}, t, config: { showPlan: true } }).node)
  const title = flatten(nodes.find(n => n.props && n.props.key === 'planbar')).find(n => n.props && n.props.className === 'dshadb_settings_row_title')
  assert.equal(title.children[0], '状态条显示套餐用量')
  const sub = flatten(nodes.find(n => n.props && n.props.key === 'planbar')).find(n => n.props && n.props.className === 'dshadb_settings_row_sub')
  assert.match(sub.children[0], /套餐/, '要有说明文案')
  planSwitch({ showPlan: true })
})
check('D2 开关默认开: config.showPlan 未设 → checked', () => {
  assert.equal(planSwitch({}).props.checked, true, '没配过也要默认开')
  assert.equal(planSwitch({ showPlan: true }).props.checked, true)
  assert.equal(planSwitch({ showPlan: false }).props.checked, false, '关掉后要如实反映')
})
check('D3 关掉开关时提交的是 false(不是删字段/undefined)', () => {
  const s = lf(source)
  // Switch 自己取反(onChange(!checked)) → togglePlan 收到 false; 保存体 !!next → false, 不是缺字段
  assert.match(s, /onClick: \(\) => onChange\(!checked\)/, 'Switch 必须传反值')
  assert.match(s, /const togglePlan = async \(next\) => \{[\s\S]{0,240}?body: JSON\.stringify\(\{ showPlan: !!next \}\)/, 'togglePlan 必须把反值原样 POST 出去')
  assert.match(s, /setShowPlan\(next\)/, '本地先生效, 不等网络')
})
check('D3 源码级: 保存只提交 showPlan 布尔, 不提交 key', () => {
  const s = lf(source)
  assert.match(s, /body: JSON\.stringify\(\{ showPlan: !!next \}\)/, '保存体必须只有 showPlan')
  assert.match(s, /typeof d\.showPlan === "boolean"\) setShowPlan\(d\.showPlan\)/, '回包要认布尔值')
  assert.match(s, /dshadb_bar_plan /, '状态条 chip 类名')
  assert.match(s, /dshadb_planbar_fill/, '看板进度条类名')
})

// ---------- E. i18n 成对 ----------
check('E1 中英文案成对 (新 key 不许只加一半)', () => {
  const s = lf(source)
  for (const k of ['plan.left', 'plan.used', 'plan.usedM', 'plan.unlimited', 'plan.unlimitedLeft', 'plan.title', 'plan.none', 'plan.unavailable', 'plan.partial', 'plan.credits', 'plan.resetAt', 'plan.expiresAt', 'plan.fiveHour', 'plan.weekly', 'plan.monthly', 'plan.bucketTotal', 'plan.bucketSub', 'plan.bucketTopup', 'plan.window', 'plan.bucket', 'plan.remaining', 'plan.total', 'settings.showPlan', 'settings.showPlanHint', 'settings.showCost', 'settings.showCostHint', 'plan.hint', 'plan.subtitle']) {
    const n = s.split('"' + k + '":').length - 1
    assert.equal(n, 2, k + ' 在文案表里出现 ' + n + ' 次, 应中英各一次')
  }
})

// ---------- F. 「本会话消耗」尾巴开关 (v1.8.0, 维护者 2026-10-27) ----------
// 维护者原话: 「最后面显示的 ~￥33.07 这个尾巴…这个组件删除掉, 要不然就是配置成一个开关」。
// 取后者: 默认关(与 showPlan 的默认开**相反**), 想留的去设置里打开。
const costSwitch = (config) => {
  const nodes = flatten(T.SettingsModal({ isOpen: true, onClose() {}, t, config }).node)
  const row = nodes.find(n => n.props && n.props.key === 'costbar')
  assert.ok(row, '缺本会话消耗开关行')
  const sw = row.children.find(c => typeof c.type === 'function' && c.props && typeof c.props.onChange === 'function')
  assert.ok(sw, '本会话消耗行里没有 Switch')
  return sw
}
check('F1 设置面板有「状态条显示本会话消耗」开关', () => {
  const nodes = flatten(T.SettingsModal({ isOpen: true, onClose() {}, t, config: { showSessionCost: true } }).node)
  const row = flatten(nodes.find(n => n.props && n.props.key === 'costbar'))
  const title = row.find(n => n.props && n.props.className === 'dshadb_settings_row_title')
  assert.equal(title.children[0], '状态条显示本会话消耗')
  const sub = row.find(n => n.props && n.props.className === 'dshadb_settings_row_sub')
  assert.match(sub.children[0], /本会话消耗/, '要有说明文案')
  costSwitch({ showSessionCost: true })
})
check('F2 开关默认关(与 showPlan 相反): config 未设 → checked=false', () => {
  assert.equal(costSwitch({}).props.checked, false, '没配过也要默认关')
  assert.equal(costSwitch({ showSessionCost: true }).props.checked, true)
  assert.equal(costSwitch({ showSessionCost: false }).props.checked, false)
})
check('F3 源码级: toggleCost 只提交 showSessionCost 布尔, 回包认布尔', () => {
  const s = lf(source)
  assert.match(s, /const toggleCost = async \(next\) => \{[\s\S]{0,240}?body: JSON\.stringify\(\{ showSessionCost: !!next \}\)/, 'toggleCost 必须把反值原样 POST 出去')
  assert.match(s, /setShowCost\(next\)/, '本地先生效, 不等网络')
  assert.match(s, /typeof d\.showSessionCost === "boolean"\) setShowCost\(d\.showSessionCost\)/, '回包要认布尔值')
})
check('F4 状态条: 尾巴只在开关打开时渲染(默认整段不占位)', () => {
  const s = lf(source)
  // 两条渲染分支(空态 / 有数据态)都要被同一个开关把着
  assert.equal(s.split('showCost ? react.createElement("span", { className: "dshadb_bar_cost"').length - 1, 2, '空态与有数据态两处都要有条件渲染')
  assert.match(s, /const showCost = config\?\.showSessionCost === true;/, '开关值从 config 读, 缺省即关')
})

console.log(fail === 0 ? '\nStep Plan 客户端 UI 回归全部通过' : '\n失败 ' + fail + ' 项')
if (fail > 0) process.exitCode = 1
