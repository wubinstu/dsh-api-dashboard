// v1.8.0: 阶跃星辰 Step Plan 订阅套餐用量 (/step_plan/v1/usage)
// 接口形状与口径**逐字段对照** stepcode 客户端:
//   D:\stepcode-stepfun-usage\extensions\lib\api.ts 的 fetchPlanUsage / computeCreditView
//   (上游 stepfun-ai/Step-Code 的 PlanUsageController)。
// 夹具不是猜的: schema_version/scope 在响应顶层, plan.family 决定口径,
// quota.windows 是 coding 族限流窗口, quota.credit_buckets 是 token 族额度桶。
// 红线 (AGENTS.md 第三节): 查不到/结构不认识 → null, 绝不用 0 冒充「已用 0%」。
const m = await import(new URL('../src/index.js', import.meta.url).pathname + '?v=' + Date.now())
let pass = 0, fail = 0
const a = (name, cond) => { if (cond) { pass++ } else { fail++; console.log('FAIL ' + name) } }

// ===== 夹具: 与参考实现实测返回逐字段对齐 =====
// Coding Plan: family='coding' → 限流窗口口径 (five_hour / weekly, 给的是**已用**百分比)
const CODING = {
  schema_version: 1,
  scope: 'personal_account',
  observed_at_ms: 1772860800000,
  plan: {
    state: 'known',
    family: 'coding',
    name: 'Coding Plan',
    subscription: { expires_at_ms: 1820275200000 },
  },
  quota: {
    state: 'known',
    allowed: true,
    reason: null,
    windows: [
      { id: 'five_hour', limited: true, used_percent: 0, resets_at_ms: 1772500200000 },
      { id: 'weekly', limited: true, used_percent: 12.5, resets_at_ms: 1772845800000 },
    ],
    credit_buckets: [
      { type: 'standard', unsupported: false, total: 0, remaining: 0, used_percent: 0 },
    ],
  },
}
// Token Plan: family='token' → 额度桶口径 (total/remaining 是原始 credit 数, 1e6 = 1M)
const TOKEN = {
  schema_version: 1,
  scope: 'personal_account',
  observed_at_ms: 1772860800000,
  plan: {
    state: 'known',
    family: 'token',
    name: 'Token Plan',
    subscription: { expires_at_ms: 1820275200000 },
  },
  quota: {
    state: 'known',
    allowed: true,
    reason: null,
    windows: [],
    credit_buckets: [
      { type: 'subscription', unsupported: false, total: 10000000, remaining: 9866666, used_percent: 1.33, resets_at_ms: 1773090000000 },
      { type: 'topup', unsupported: false, total: 5000000, remaining: 5000000, used_percent: 0 },
      { type: 'gift', unsupported: true, total: 250000000, remaining: 249977649, used_percent: 0.009, expires_at_ms: 1820275200000 },
    ],
  },
}

// ===== ① Coding Plan 解析 (限流窗口口径) =====
{
  const p = m.parseStepfunPlan(CODING)
  a('P1 Coding 族判定 (plan.family)', p !== null && p.family === 'coding')
  a('P1 套餐名/订阅到期透传', p.planName === 'Coding Plan' && p.expiresAt === 1820275200000)
  a('P1 两个限流窗口都进来', p.windows.length === 2 && p.windows[0].id === 'five_hour')
  a('P1 used_percent 原样透传 (已用%, 方向不能反)', p.windows[1].usedPercent === 12.5)
  a('P1 *_ms 时间戳不再换算', p.windows[0].resetsAt === 1772500200000)
  a('P1 unsupported 的桶仍解析但不参与聚合', p.buckets.length === 1 && p.buckets[0].unsupported === true)
  const v = m.summarizeStepfunPlan(p)
  a('P2 视图 kind = windows', v.kind === 'windows')
  a('P2 主显示 = 5 小时窗口 (会话中最先耗尽的那个)', v.primary && v.primary.key === 'five_hour')
  a('P2 已用 0% → 剩余 100%', v.primary.leftPercent === 100)
  a('P2 已用 12.5% → 剩余 87.5%', v.weeklyLeftPercent === 87.5)
  a('P3 两窗口都占一行 (unsupported 桶不占)', v.rows.length === 2 && v.rows.every(r => r.kind === 'window'))
  a('P3 窗口重置时间原样 (ms)', v.rows[0].resetsAt === 1772500200000)
}

// ===== ② Token Plan 解析 (额度桶口径) =====
{
  const p = m.parseStepfunPlan(TOKEN)
  a('P4 Token 族判定', p !== null && p.family === 'token' && p.windows.length === 0)
  a('P4 三个桶都解析, unsupported 只标不改', p.buckets.length === 3 && p.buckets[2].unsupported === true)
  const v = m.summarizeStepfunPlan(p)
  a('P4 只有 supported 桶进视图 (subscription + topup)', v.rows.length === 2 && v.rows.every(r => r.kind === 'bucket'))
  a('P5 官方百分比按 total 加权 (1.33×10M / 15M = 0.8867%) → 剩 99.11% (两位, 不砍成 1 位)', Math.round(v.leftPercent * 100) / 100 === 99.11)
  a('P5 聚合 usedM/totalM (单位 M credits)', Math.abs(v.usedM - 0.133334) < 1e-9 && v.totalM === 15)
  a('P5 桶明细折成 M (9866666 → 9.866666)', Math.abs(v.rows[0].remainingM - 9.866666) < 1e-9 && v.rows[0].totalM === 10)
  a('P5 桶自身剩余% (已用 1.33% → 剩 98.67%)', v.rows[0].leftPercent === 98.67)
  a('P6 月度重置时间透传', v.rows[0].resetsAt === 1773090000000 && v.rows[1].resetsAt === null)
  a('P6 主显示 = 整体剩余% (99.11 全精度, 不预砍)', v.primary && v.primary.key === 'total' && Math.round(v.primary.leftPercent * 100) / 100 === 99.11)
}

// ===== ③ 边界与兜底 =====
{
  // limited=false = 不限量: 仍占一行, 剩余记 100% (与参考实现的 pct() 同口径)
  const unlimited = m.parseStepfunPlan({
    schema_version: 1, scope: 'personal_account',
    plan: { state: 'known', family: 'coding', name: 'Coding Plan', subscription: {} },
    quota: { state: 'known', allowed: true, windows: [{ id: 'five_hour', limited: false, used_percent: 0 }], credit_buckets: [] },
  })
  const vu = m.summarizeStepfunPlan(unlimited)
  a('P7 不限量窗口 → 剩余 100% 且标 unlimited', vu.rows.length === 1 && vu.rows[0].unlimited === true && vu.rows[0].leftPercent === 100)

  // 完全不认识的窗口 id: 没有对应文案, 过滤掉而不是渲染一个空行
  const oddWin = m.parseStepfunPlan({
    schema_version: 1, scope: 'personal_account',
    plan: { state: 'known', family: 'coding', name: 'C', subscription: {} },
    quota: { state: 'known', allowed: true, windows: [{ id: 'monthly', limited: true, used_percent: 50 }], credit_buckets: [] },
  })
  a('P8 只认 five_hour / weekly, 别的窗口 id 过滤', oddWin.windows.length === 0 && m.summarizeStepfunPlan(oddWin).primary === null)

  // 缺 used_percent 时用 remaining/total 自己算 (750/1000 = 已用 75%)
  const noPct = m.parseStepfunPlan({
    schema_version: 1, scope: 'personal_account',
    plan: { state: 'known', family: 'token', name: 'T', subscription: {} },
    quota: { state: 'known', allowed: true, credit_buckets: [{ type: 'subscription', total: 1000, remaining: 250, used_percent: null }] },
  })
  const vnp = m.summarizeStepfunPlan(noPct)
  a('P9 缺 used_percent 时自己算 → 剩余 25%', vnp.primary.leftPercent === 25)
  a('P9 桶明细也走同一算式', vnp.rows[0].leftPercent === 25)

  // total 为 0 / 缺失: 算不出百分比, 不占行; 一个能算的都没有 → kind='none'
  const zeroTotal = m.parseStepfunPlan({
    schema_version: 1, scope: 'personal_account',
    plan: { state: 'known', family: 'token', name: 'T', subscription: {} },
    quota: { state: 'known', allowed: true, credit_buckets: [{ type: 'subscription', total: 0, remaining: 0, used_percent: null }] },
  })
  a('P10 total=0 的桶不占行, 无可用数据 → none', m.summarizeStepfunPlan(zeroTotal).kind === 'none' && m.summarizeStepfunPlan(zeroTotal).rows.length === 0)

  // family='none': 套餐本身没有可用明细 → none (quota 显式 allowed=true, 否则算 unavailable)
  const noQuota = m.parseStepfunPlan({
    schema_version: 1, scope: 'personal_account',
    plan: { state: 'known', family: 'none', name: '无套餐', subscription: {} },
    quota: { state: 'known', allowed: true, windows: [], credit_buckets: [] },
  })
  a('P11 family=none → none', noQuota.family === 'none' && m.summarizeStepfunPlan(noQuota).kind === 'none')

  // 整个 quota 缺失 → allowed 解析成 false → unavailable (与参考实现同口径: 查不了就是查不了)
  const noQuotaAtAll = m.parseStepfunPlan({
    schema_version: 1, scope: 'personal_account',
    plan: { state: 'known', family: 'coding', name: 'Coding Plan', subscription: {} },
  })
  a('P11b 整个 quota 缺失 → unavailable', m.summarizeStepfunPlan(noQuotaAtAll).kind === 'unavailable' && m.summarizeStepfunPlan(noQuotaAtAll).rows.length === 0)

  // plan.state='unavailable': 套餐存在但查不了 → 不带任何行 (kind='none')
  const unavailPlan = m.parseStepfunPlan({
    schema_version: 1, scope: 'personal_account',
    plan: { state: 'unavailable', family: 'none', name: '', subscription: {} },
    quota: { state: 'known', allowed: true, windows: [], credit_buckets: [] },
  })
  a('P12 plan.state=unavailable → none', m.summarizeStepfunPlan(unavailPlan).kind === 'none' && m.summarizeStepfunPlan(unavailPlan).planName === null)

  // quota.allowed=false: 没订阅/无权查 → unavailable, 原样带 reason
  const noSub = m.parseStepfunPlan({
    schema_version: 1, scope: 'personal_account',
    plan: { state: 'known', family: 'coding', name: 'Coding Plan', subscription: { expires_at_ms: 1820275200000 } },
    quota: { state: 'known', allowed: false, reason: 'no_subscription', windows: [], credit_buckets: [] },
  })
  const v2 = m.summarizeStepfunPlan(noSub)
  a('P13 未订阅 → unavailable 且不带任何行', v2.kind === 'unavailable' && v2.reason === 'no_subscription' && v2.rows.length === 0 && v2.primary === null)

  // 结构不认识的一律 null (不猜字段, 不拿 0 冒充)
  a('P14 schema_version 变了 → null', m.parseStepfunPlan({ ...CODING, schema_version: 2 }) === null)
  a('P14 schema_version 是字符串 → null (严格, 与参考实现同)', m.parseStepfunPlan({ ...CODING, schema_version: '1' }) === null)
  a('P15 scope 不是个人账户 → null', m.parseStepfunPlan({ ...CODING, scope: 'team' }) === null)
  a('P16 没有 plan → null', m.parseStepfunPlan({ schema_version: 1, scope: 'personal_account' }) === null)
  a('P17 非对象输入一律 null', m.parseStepfunPlan(null) === null && m.parseStepfunPlan('x') === null && m.parseStepfunPlan([]) === null)
  a('P18 summarize(null) → null', m.summarizeStepfunPlan(null) === null)

  // quota.state='partial': 部分数据仍如实显示, 只是标出来
  const partial = m.parseStepfunPlan({
    schema_version: 1, scope: 'personal_account',
    plan: { state: 'known', family: 'coding', name: 'C', subscription: {} },
    quota: { state: 'partial', allowed: true, windows: [{ id: 'five_hour', limited: true, used_percent: 40, resets_at_ms: 1772500200000 }], credit_buckets: [] },
  })
  const vp = m.summarizeStepfunPlan(partial)
  a('P19 partial 状态仍渲染 (已用 40% → 剩 60%)', vp.quotaState === 'partial' && vp.primary.leftPercent === 60)

  // 时间戳: 0 / 缺失 / 非整数 → null
  const mixed = m.parseStepfunPlan({
    schema_version: 1, scope: 'personal_account',
    plan: { state: 'known', family: 'token', name: 'T', subscription: { expires_at_ms: 0 } },
    quota: {
      state: 'known', allowed: true,
      credit_buckets: [
        { type: 'subscription', total: 1000, remaining: 250, used_percent: null, resets_at_ms: 1772500200000, expires_at_ms: null },
        { type: 'topup', total: 1000, remaining: 500, used_percent: null, resets_at_ms: 1772500200000.5 },
      ],
    },
  })
  a('P20 已是 ms 的时间戳原样', mixed.buckets[0].resetsAt === 1772500200000)
  a('P20 0/缺失/非整数的 *_ms → null', mixed.expiresAt === null && mixed.buckets[0].expiresAt === null && mixed.buckets[1].resetsAt === null)

  // 已用 100% → 剩余 0% (方向不能反; 0% 是真实 0, 不是解析失败)
  const usedUp = m.parseStepfunPlan({
    schema_version: 1, scope: 'personal_account',
    plan: { state: 'known', family: 'coding', name: 'C', subscription: {} },
    quota: { state: 'known', allowed: true, windows: [{ id: 'five_hour', limited: true, used_percent: 100, resets_at_ms: 1 }], credit_buckets: [] },
  })
  a('P21 已用 100% → 剩余 0%', m.summarizeStepfunPlan(usedUp).primary.leftPercent === 0)

  // family 缺失时按 token 兜底 (与参考实现的 ?? "token" 同)
  const noFamily = m.parseStepfunPlan({
    schema_version: 1, scope: 'personal_account',
    plan: { state: 'known', name: 'X', subscription: {} },
    quota: { state: 'known', allowed: true, credit_buckets: [{ type: 'subscription', total: 1000, remaining: 1000, used_percent: 0 }] },
  })
  a('P22 family 缺失 → 按 token 处理', noFamily.family === 'token' && m.summarizeStepfunPlan(noFamily).kind === 'buckets')

  // observed_at_ms 缺失 → 用当前时间兜底 (不能是 null, 客户端要显示「更新于」)
  const noObserved = m.parseStepfunPlan({
    schema_version: 1, scope: 'personal_account',
    plan: { state: 'known', family: 'coding', name: 'C', subscription: {} },
    quota: { state: 'known', allowed: true, windows: [], credit_buckets: [] },
  })
  a('P23 observed_at_ms 缺失 → 当前时间兜底', typeof noObserved.observedAt === 'number' && noObserved.observedAt > 1e12)
}

// ===== ④ 主机判定 (自定义中转站指向阶跃官方时才查套餐) =====
{
  a('P24 api.stepfun.com → true', m.isStepfunPlanHost('https://api.stepfun.com') === true)
  a('P24 带路径也认', m.isStepfunPlanHost('https://api.stepfun.com/v1') === true)
  a('P24 子域认', m.isStepfunPlanHost('https://foo.stepfun.com') === true)
  a('P24 别人的中转站 → false', m.isStepfunPlanHost('https://relay.example.com') === false)
  a('P24 空/坏 URL → false', m.isStepfunPlanHost('') === false && m.isStepfunPlanHost('not a url') === false)
  a('P24 伪装成子域的别域名 → false', m.isStepfunPlanHost('https://api.stepfun.com.evil.example') === false)
}

// ===== ⑤ 并进余额对象: 只有真拿到才并, 失败/未开放都不留痕 =====
{
  const bal = { platform: 'stepfun', status: 'ok', total: 44.33, currency: 'CNY' }
  a('P25 查询失败 → 原对象不带 plan 字段', m.attachStepfunPlan(bal, { plan: null, error: 'HTTP 404' }).plan === undefined)
  a('P25 原对象不被改写', m.attachStepfunPlan(bal, { plan: null }).total === 44.33)
  const withPlan = m.attachStepfunPlan(bal, { plan: m.parseStepfunPlan(CODING), error: null })
  a('P25 拿到套餐 → 带 plan + planView', withPlan.plan.family === 'coding' && withPlan.planView.primary.key === 'five_hour')
  a('P25 余额字段原样保留', withPlan.total === 44.33 && withPlan.plan !== undefined)
  a('P25 坏输入原样返回', m.attachStepfunPlan(bal, null) === bal && m.attachStepfunPlan(bal, {}) === bal)
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail > 0) process.exitCode = 1
