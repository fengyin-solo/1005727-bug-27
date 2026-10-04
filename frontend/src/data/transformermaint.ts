import type { EntryRow, PageResult } from './types'

/**
 * 主变检修领域逻辑：检修类别/计划工期补全、同主变去重、排序分页、超期判定
 * 都集中在这里。列表与详情读同一份规整后的数据，两处的主变名称、工期不会再各说各话。
 */

export const TRANSFORMER_KEY = 'transformermaint'
export const WORKPERMIT_KEY = 'workpermit'

export const FIELD_CODE = '检修编号'
export const FIELD_NAME = '主变名称'
export const FIELD_CATEGORY = '检修类别'
export const FIELD_SCOPE = '停电范围'
export const FIELD_TEAM = '检修班组'
export const FIELD_PLAN = '计划工期'
export const FIELD_APPROVED = '调度批复工期'
export const FIELD_FINISH = '完成日期'
export const FIELD_STATUS = '检修状态'

/** 检修类别必须写全，就按这四类登记，历史记录里的其它写法保留并提示补录。 */
export const MAINT_CATEGORIES = ['A类检修', 'B类检修', 'C类检修', 'D类检修']

export const TRANSFORMER_STATUSES = ['待开工', '检修中', '已完工', '已延期'] as const

/** 历史记录字段缺失时的占位写法，界面上会单独标出，提醒补录，但不丢老数据。 */
export const LEGACY_PLACEHOLDER = '未登记（待补录）'

/** 默认一页十条，翻页、排序、页码跳转共用。 */
export const PAGE_SIZE = 10

export type SortState = {
  field: string
  order: 'asc' | 'desc'
}

export type TransformerQuery = {
  filters: Record<string, string>
  sort: SortState
  page: number
  size: number
  today: string
}

export type TransformerPageResult = PageResult & {
  /** 按当前筛选条件统计的各状态数量（基于全量筛选结果，不是只看当前页）。 */
  statusCounts: Record<string, number>
  overdueUnfinished: number
  /** 当前筛选条件下本月完工数，保证顶部统计与列表口径一致。 */
  monthFinished: number
}

const DATE_RE = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/g

/** 从工期文本里抽出所有日期，兼容「2026-09-01 至 2026-09-05」「2026/09/01~09-05」等写法。 */
export function parseDates(text: string): string[] {
  const dates: string[] = []
  const matches = String(text ?? '').matchAll(DATE_RE)
  for (const match of matches) {
    const month = match[2].padStart(2, '0')
    const day = match[3].padStart(2, '0')
    dates.push(`${match[1]}-${month}-${day}`)
  }
  return dates
}

/** 工期结束日：取文本里最后一个可识别日期，识别不出来返回空串。 */
export function scheduleEnd(text: string): string {
  const dates = parseDates(text)
  return dates.length ? dates[dates.length - 1] : ''
}

/** 工期开始日：取文本里第一个可识别日期。 */
export function scheduleStart(text: string): string {
  const dates = parseDates(text)
  return dates.length ? dates[0] : ''
}

/**
 * 实际执行工期：有调度批复工期且能解析时，一律以调度批复为准（冲突时也认它）；
 * 批复工期缺失或解析不出来才退回计划工期。
 */
export function effectiveSchedule(row: EntryRow): { end: string; source: 'approved' | 'plan' | 'none' } {
  const approvedEnd = scheduleEnd(String(row[FIELD_APPROVED] ?? ''))
  if (approvedEnd) {
    return { end: approvedEnd, source: 'approved' }
  }
  const planEnd = scheduleEnd(String(row[FIELD_PLAN] ?? ''))
  if (planEnd) {
    return { end: planEnd, source: 'plan' }
  }
  return { end: '', source: 'none' }
}

/** 已完工不算超期；其余状态只要实际工期结束日早于今天就算超期。 */
export function isOverdue(row: EntryRow, today: string): boolean {
  if (String(row.status) === '已完工') {
    return false
  }
  const { end } = effectiveSchedule(row)
  return end !== '' && end < today
}

export function overdueDays(row: EntryRow, today: string): number {
  if (!isOverdue(row, today)) {
    return 0
  }
  const { end } = effectiveSchedule(row)
  return Math.max(0, Math.round((new Date(today).getTime() - new Date(end).getTime()) / 86400000))
}

/** 计划工期、调度批复工期展示成区间，原文无法识别时直接展示原文（兼容历史写法）。 */
export function formatSchedule(text: string): string {
  const value = String(text ?? '').trim()
  if (!value) {
    return '—'
  }
  const dates = parseDates(value)
  if (dates.length >= 2) {
    return `${dates[0]} 至 ${dates[dates.length - 1]}`
  }
  if (dates.length === 1) {
    return dates[0]
  }
  return value
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim() === ''
}

/** 仓库初始化阶段的占位写法（如「主变检修样例1」），字段虽非空但并无业务含义，一并标成待补录。 */
function isPlaceholderText(value: unknown): boolean {
  return /主变检修样例\d+$/.test(String(value ?? '').trim())
}

function needsFill(value: unknown): boolean {
  return isBlank(value) || isPlaceholderText(value)
}

/**
 * 规整既有检修记录：
 * 1. 补齐新老字段（含调度批复工期），缺失的检修类别/计划工期标成待补录，不丢历史数据；
 * 2. 同一台主变重复提交、计划工期也相同的只留一条（保留后提交/编号最大的那条）；
 * 3. 按检修编号（等价于 id 升序）排稳，后续排序、翻页、详情都基于这一份数据。
 */
export function normalizeTransformerRows(rows: EntryRow[]): EntryRow[] {
  const filled = rows.map((row) => {
    const next: EntryRow = { ...row }
    for (const field of [
      FIELD_CODE,
      FIELD_NAME,
      FIELD_CATEGORY,
      FIELD_SCOPE,
      FIELD_TEAM,
      FIELD_PLAN,
    ]) {
      if (needsFill(next[field])) {
        next[field] = LEGACY_PLACEHOLDER
      } else {
        next[field] = String(next[field]).trim()
      }
    }
    if (isBlank(next[FIELD_FINISH])) {
      next[FIELD_FINISH] = ''
    } else {
      next[FIELD_FINISH] = String(next[FIELD_FINISH]).trim()
    }
    if (isBlank(next[FIELD_APPROVED])) {
      next[FIELD_APPROVED] = ''
    } else {
      next[FIELD_APPROVED] = String(next[FIELD_APPROVED]).trim()
    }
    return next
  })

  // 同一台主变 + 同一段计划工期视为重复提交；占位的历史记录不参与去重，原样保留。
  const latestByName = new Map<string, EntryRow>()
  for (const row of filled) {
    const name = String(row[FIELD_NAME])
    const plan = String(row[FIELD_PLAN])
    if (name === LEGACY_PLACEHOLDER || plan === LEGACY_PLACEHOLDER) {
      continue
    }
    const key = `${name}@@${plan}`
    const prev = latestByName.get(key)
    if (!prev || Number(row.id) > Number(prev.id)) {
      latestByName.set(key, row)
    }
  }

  return filled
    .filter((row) => {
      const name = String(row[FIELD_NAME])
      const plan = String(row[FIELD_PLAN])
      if (name === LEGACY_PLACEHOLDER || plan === LEGACY_PLACEHOLDER) {
        return true
      }
      return latestByName.get(`${name}@@${plan}`)?.id === row.id
    })
    .sort((a, b) => Number(a.id) - Number(b.id))
}

/** 条件筛选：检修编号优先精确匹配（定位要准），其余字段做包含匹配；空条件不筛。 */
export function filterTransformerRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters)
    .map(([field, value]) => [field, value.trim()] as const)
    .filter(([, value]) => value !== '')
  if (pairs.length === 0) {
    return rows
  }

  const exactCode = pairs.find(([field]) => field === FIELD_CODE)?.[1]
  const otherPairs = pairs.filter(([field]) => field !== FIELD_CODE)

  let matched = rows
  if (exactCode) {
    const exact = rows.filter((row) => String(row[FIELD_CODE]) === exactCode)
    matched = exact.length
      ? exact
      : rows.filter((row) => String(row[FIELD_CODE]).includes(exactCode))
  }
  if (otherPairs.length) {
    matched = matched.filter((row) =>
      otherPairs.every(([field, value]) => String(row[field] ?? '').includes(value)),
    )
  }
  return matched
}

/** 统一排序：计划工期按实际开始日排，完成日期按日期排，其余字段按文本排；同值再按 id 兜底。 */
export function sortTransformerRows(rows: EntryRow[], sort: SortState): EntryRow[] {
  const direction = sort.order === 'desc' ? -1 : 1
  const valueOf = (row: EntryRow): string => {
    const raw = String(row[sort.field] ?? '')
    if (sort.field === FIELD_PLAN) {
      return scheduleStart(raw) || raw
    }
    if (sort.field === FIELD_FINISH) {
      return raw || '9999-12-31'
    }
    return raw
  }
  return [...rows].sort((a, b) => {
    const va = valueOf(a)
    const vb = valueOf(b)
    if (va === vb) {
      return Number(a.id) - Number(b.id)
    }
    return va < vb ? -direction : direction
  })
}

export function clampPage(page: number, totalPages: number): { page: number; notice: string } {
  if (totalPages === 0) {
    // 筛选后没有数据时停在第一页，空表格本身就是查询结果，不算越界。
    return { page: 1, notice: '' }
  }
  if (!Number.isFinite(page) || page < 1) {
    return { page: 1, notice: '页码必须是不小于 1 的正整数，已回到第一页。' }
  }
  const rounded = Math.floor(page)
  if (rounded > totalPages) {
    return {
      page: 1,
      notice: `当前条件下只有 ${totalPages} 页，第 ${page} 页超出范围，已回到第一页。`,
    }
  }
  return { page: rounded, notice: '' }
}

export function paginate(rows: EntryRow[], page: number, size: number): PageResult {
  const totalPages = Math.max(1, Math.ceil(rows.length / size))
  const clamped = clampPage(page, totalPages)
  const start = (clamped.page - 1) * size
  return {
    items: rows.slice(start, start + size),
    total: rows.length,
    page: clamped.page,
    size,
    totalPages: rows.length === 0 ? 1 : totalPages,
    notice: clamped.notice,
  }
}

/** 列表唯一入口：规整 → 条件筛选 → 统一排序 → 分页，排序、翻页、页码跳转共用它。 */
export function queryTransformerPage(
  rows: EntryRow[],
  query: TransformerQuery,
): TransformerPageResult {
  const normalized = normalizeTransformerRows(rows)
  const filtered = filterTransformerRows(normalized, query.filters)
  const sorted = sortTransformerRows(filtered, query.sort)
  const page = paginate(sorted, query.page, query.size)

  const statusCounts: Record<string, number> = {}
  for (const status of TRANSFORMER_STATUSES) {
    statusCounts[status] = 0
  }
  let overdueUnfinished = 0
  const monthPrefix = query.today.slice(0, 7)
  let monthFinished = 0
  for (const row of filtered) {
    const status = String(row.status)
    statusCounts[status] = (statusCounts[status] ?? 0) + 1
    if (isOverdue(row, query.today)) {
      overdueUnfinished += 1
    }
    if (status === '已完工' && String(row[FIELD_FINISH]).slice(0, 7) === monthPrefix) {
      monthFinished += 1
    }
  }

  return { ...page, statusCounts, overdueUnfinished, monthFinished }
}

function requiredFields(form: Record<string, string>): string[] {
  // 检修类别与计划工期必须写全，主变名称/编号/停电范围/班组同样是登记必填项。
  return [FIELD_CODE, FIELD_NAME, FIELD_CATEGORY, FIELD_SCOPE, FIELD_TEAM, FIELD_PLAN].filter(
    (field) => !String(form[field] ?? '').trim(),
  )
}

/** 登记校验：必填写全 + 编号不重 + 同一台主变在修记录只留一条，重复提交直接拦下。 */
export function validateNewTransformer(
  rows: EntryRow[],
  form: Record<string, string>,
): { ok: boolean; message: string } {
  const missing = requiredFields(form)
  if (missing.length) {
    return { ok: false, message: `以下必填项未填写完整：${missing.join('、')}` }
  }
  const code = form[FIELD_CODE].trim()
  if (rows.some((row) => String(row[FIELD_CODE]) === code)) {
    return { ok: false, message: `检修编号 ${code} 已存在，不能重复登记` }
  }
  const name = form[FIELD_NAME].trim()
  const plan = form[FIELD_PLAN].trim()
  const duplicate = rows.find(
    (row) =>
      String(row[FIELD_NAME]) === name &&
      String(row[FIELD_PLAN]) === plan &&
      String(row.status) !== '已完工',
  )
  if (duplicate) {
    return {
      ok: false,
      message: `主变「${name}」在计划工期 ${formatSchedule(plan)} 已有检修单 ${String(
        duplicate[FIELD_CODE],
      )}（${String(duplicate.status)}），同一台主变的重复检修只保留一条`,
    }
  }
  if (form[FIELD_APPROVED]?.trim() && !parseDates(form[FIELD_APPROVED].trim()).length) {
    return { ok: false, message: '调度批复工期未能识别，请填写如 2026-10-01 至 2026-10-05 的日期' }
  }
  if (!parseDates(plan).length) {
    return { ok: false, message: '计划工期未能识别，请填写如 2026-10-01 至 2026-10-05 的日期' }
  }
  return { ok: true, message: '' }
}

export function isLegacyValue(value: unknown): boolean {
  return String(value ?? '') === LEGACY_PLACEHOLDER
}
