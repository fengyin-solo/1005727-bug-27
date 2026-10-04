import { MODULE_BY_KEY } from '@/data/modules'
import type { EntryRow } from '@/data/types'

/**
 * 主变检修领域数据：列表、详情、工作票待办三处共用同一份规范化结果。
 * 历史记录的字段名五花八门（计划工期/计划停电时间/停电起止、主变名称/设备名称），
 * 统一在这里归一化；同一台主变同一次安排重复提交只保留一条。
 */

export const TRANSFORMER_MAINT_KEY = 'transformermaint'

export type MaintRecord = {
  id: number
  status: string
  检修编号: string
  主变名称: string
  所属变电站: string
  检修类别: string
  停电范围: string
  检修班组: string
  计划工期: string
  调度批复工期: string
  完成日期: string
  /** 列表排序、工期判定实际使用的工期；冲突时以调度批复的工期为准。 */
  生效工期: string
  计划开始: string
  计划完工: string
  批复开始: string
  批复完工: string
  /** 今天仍未完工且已过生效工期完工日。 */
  超期: boolean
  异常: boolean
  /** 被合并掉的重复提交检修编号，详情面板里向用户说明。 */
  合并记录: string[]
  /** 工期取值来源说明，例如「调度批复工期与计划工期不一致，以调度批复工期为准」。 */
  工期说明: string
}

export type MaintQuery = {
  filters?: Record<string, string>
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  page?: number
  size?: number
}

export type MaintPage = {
  items: MaintRecord[]
  total: number
  page: number
  size: number
  totalPages: number
  /** 筛选后全量数据的分状态计数，供状态图例使用，不受分页影响。 */
  statusCount: Record<string, number>
  /** 页码被纠正时带回的说明（越界回到第一页等）。 */
  notice: string
  /** 本次规范化过程中产生的提示（合并重复提交等）。 */
  notices: string[]
}

const PAGE_SIZE = 10

function text(row: EntryRow, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key]
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim()
    }
  }
  return ''
}

/** 把「2026/9/1」「2026.9.1」「2026年09月01日」之类的历史写法归一成 YYYY-MM-DD。 */
function normalizeDate(value: string): string {
  if (!value) {
    return ''
  }
  const matched = value.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/)
  if (!matched) {
    return ''
  }
  const [, year, month, day] = matched
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

/** 从一段工期文本里拆出起止日期，兼容「2026-09-01 至 2026-09-03」等写法。 */
function splitRange(value: string): { start: string; end: string } {
  if (!value) {
    return { start: '', end: '' }
  }
  const dates = value.match(/\d{4}\D+\d{1,2}\D+\d{1,2}/g) ?? []
  const normalized = dates.map(normalizeDate).filter(Boolean)
  if (normalized.length >= 2) {
    return { start: normalized[0], end: normalized[normalized.length - 1] }
  }
  if (normalized.length === 1) {
    // 只有一个日期的历史记录：视为当天完工的一天工期。
    return { start: normalized[0], end: normalized[0] }
  }
  return { start: '', end: '' }
}

function today(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function effectiveRange(planned: string, approved: string): { start: string; end: string } {
  const plan = splitRange(planned)
  const grant = splitRange(approved)
  // 冲突时以调度批复的工期为准；批复只给了一端时用计划工期补齐另一端。
  return {
    start: grant.start || plan.start,
    end: grant.end || plan.end,
  }
}

function formatRange(start: string, end: string): string {
  if (!start && !end) {
    return ''
  }
  return `${start || '日期未填'} 至 ${end || '日期未填'}`
}

/** 同一台主变、同一次检修安排（计划开工日相同）重复提交，只保留一条；保留最新提交。 */
function dedupeKey(record: MaintRecord): string {
  return `${record.主变名称}__${record.计划开始 || record.批复开始 || record.计划工期}`
}

export function normalizeMaintRows(rows: EntryRow[], currentDate: string = today()): MaintRecord[] {
  const records: MaintRecord[] = rows.map((row) => {
    const 计划工期 = text(row, '计划工期', '计划停电时间', '停电起止', '停电时间')
    const 调度批复工期 = text(row, '调度批复工期', '批复工期', '批准工期', '批复停电时间')
    const planRange = splitRange(计划工期)
    const grantRange = splitRange(调度批复工期)
    const effect = effectiveRange(计划工期, 调度批复工期)

    const hasConflict =
      grantRange.start !== '' &&
      grantRange.end !== '' &&
      (grantRange.start !== planRange.start || grantRange.end !== planRange.end)

    const status = text(row, '检修状态') || String(row.status ?? '')
    const 完成日期 = normalizeDate(text(row, '完成日期', '完工日期', '实际完工日期'))
    const 超期 = effect.end !== '' && 完成日期 === '' && status !== '已完工' && currentDate > effect.end

    return {
      id: Number(row.id),
      status: String(row.status ?? ''),
      检修编号: text(row, '检修编号', '工作票编号', '编号'),
      主变名称: text(row, '主变名称', '设备名称', '主变'),
      所属变电站: text(row, '所属变电站', '变电站', '站名'),
      检修类别: text(row, '检修类别', '检修类型', '检修等级'),
      停电范围: text(row, '停电范围', '停电设备'),
      检修班组: text(row, '检修班组', '工作班组', '负责班组'),
      计划工期,
      调度批复工期,
      完成日期,
      生效工期: formatRange(effect.start, effect.end),
      计划开始: planRange.start,
      计划完工: planRange.end,
      批复开始: grantRange.start,
      批复完工: grantRange.end,
      超期,
      异常: Boolean(row.abnormal),
      合并记录: [],
      工期说明: hasConflict
        ? '调度批复工期与计划工期不一致，以调度批复工期为准'
        : 调度批复工期
          ? '已按调度批复工期执行'
          : '按计划工期执行',
    }
  })

  // 去重：同主变同一次安排，id 最大（最新提交）的留下，其余编号记进合并记录。
  const latest = new Map<string, MaintRecord>()
  for (const record of records) {
    const key = dedupeKey(record)
    const existing = latest.get(key)
    if (!existing) {
      latest.set(key, record)
      continue
    }
    if (record.id > existing.id) {
      record.合并记录 = [...existing.合并记录, existing.检修编号].filter(Boolean)
      latest.set(key, record)
    } else {
      existing.合并记录 = [...existing.合并记录, record.检修编号].filter(Boolean)
    }
  }
  return [...latest.values()]
}

const SORTABLE_FIELDS: (keyof MaintRecord)[] = [
  '检修编号',
  '主变名称',
  '检修类别',
  '计划工期',
  '完成日期',
]

function compare(a: MaintRecord, b: MaintRecord, field: string): number {
  if (field === '完成日期') {
    return (a.完成日期 || '').localeCompare(b.完成日期 || '')
  }
  if (field === '计划工期') {
    return (a.计划开始 || '').localeCompare(b.计划开始 || '')
  }
  return String(a[field as keyof MaintRecord] ?? '').localeCompare(
    String(b[field as keyof MaintRecord] ?? ''),
  )
}

/** 检修编号精确定位（TRAN-0012 直接命中），其余字段包含匹配；条件全部保留。 */
function applyFilters(records: MaintRecord[], filters: Record<string, string>): MaintRecord[] {
  const pairs = Object.entries(filters)
    .map(([field, value]) => [field, value.trim()] as const)
    .filter(([, value]) => value !== '')
  if (pairs.length === 0) {
    return records
  }
  return records.filter((record) =>
    pairs.every(([field, value]) => {
      const target = String(record[field as keyof MaintRecord] ?? '')
      if (field === '检修编号') {
        return target === value || target.toUpperCase().includes(value.toUpperCase())
      }
      if (field === '检修状态') {
        return record.status.includes(value)
      }
      return target.includes(value)
    }),
  )
}

export function queryMaintRecords(
  rows: EntryRow[],
  query: MaintQuery = {},
  currentDate: string = today(),
): MaintPage {
  const notices: string[] = []
  const normalized = normalizeMaintRows(rows, currentDate)

  const mergedCount = normalized.reduce((sum, record) => sum + record.合并记录.length, 0)
  if (mergedCount > 0) {
    const merged = normalized
      .filter((record) => record.合并记录.length > 0)
      .map((record) => record.合并记录.map((code) => `${code}并入${record.检修编号}`).join('、'))
    notices.push(`同一台主变重复提交的检修只保留一条：${merged.join('；')}`)
  }

  const size = query.size && query.size > 0 ? query.size : PAGE_SIZE
  const filtered = applyFilters(normalized, query.filters ?? {})

  const sortField = query.sortBy && SORTABLE_FIELDS.includes(query.sortBy as keyof MaintRecord)
    ? query.sortBy
    : '检修编号'
  const dir = query.sortDir === 'desc' ? -1 : 1
  const sorted = [...filtered].sort((a, b) => compare(a, b, sortField) * dir)

  const total = sorted.length
  const totalPages = Math.max(1, Math.ceil(total / size))

  const requested = Number(query.page)
  let page = Number.isFinite(requested) ? Math.floor(requested) : 1
  let notice = ''
  if (!Number.isFinite(requested) || page < 1 || page > totalPages) {
    if (total === 0) {
      notice = '当前条件下没有匹配的检修记录，已回到第一页'
    } else if (!Number.isFinite(requested)) {
      notice = '页码无效，已回到第一页'
    } else {
      notice = `第 ${requested} 页不存在（共 ${totalPages} 页），已回到第一页`
    }
    page = 1
  }

  const statusCount: Record<string, number> = {}
  for (const record of sorted) {
    statusCount[record.status] = (statusCount[record.status] ?? 0) + 1
  }

  const start = (page - 1) * size
  return {
    items: sorted.slice(start, start + size),
    total,
    page,
    size,
    totalPages,
    statusCount,
    notice,
    notices,
  }
}

/** 全部去重、规范化后的记录，供统计、详情与工作票待办共用。 */
export function allMaintRecords(rows: EntryRow[], currentDate: string = today()): MaintRecord[] {
  return normalizeMaintRows(rows, currentDate)
}

/** 详情按编号定位，与列表取自同一份规范化数据，主变名称等字段不会出现两处不一致。 */
export function findMaintRecord(
  records: MaintRecord[],
  id: number,
): MaintRecord | undefined {
  return records.find((record) => record.id === id)
}

export function maintColumns(): string[] {
  const meta = MODULE_BY_KEY.get(TRANSFORMER_MAINT_KEY)
  return meta ? meta.fields : []
}
