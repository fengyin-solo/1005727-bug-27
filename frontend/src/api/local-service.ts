import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import {
  FIELD_APPROVED,
  FIELD_CATEGORY,
  FIELD_CODE,
  FIELD_FINISH,
  FIELD_NAME,
  FIELD_PLAN,
  FIELD_SCOPE,
  FIELD_TEAM,
  PAGE_SIZE,
  TRANSFORMER_KEY,
  TRANSFORMER_STATUSES,
  WORKPERMIT_KEY,
  effectiveSchedule,
  formatSchedule,
  isOverdue,
  normalizeTransformerRows,
  queryTransformerPage,
  validateNewTransformer,
} from '@/data/transformermaint'
import type {
  ActionResult,
  EntryRow,
  ListQuery,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

const PERMIT_TASK_PREFIX = '【超期检修待办】'

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

/** 通用模块列表：条件筛选 + 稳定排序 + 分页，页码越界统一回到第一页并说明原因。 */
export function listEntries(key: string, query: ListQuery = {}): PageResult {
  const filters = query.filters ?? {}
  const size = query.size && query.size > 0 ? query.size : PAGE_SIZE
  const sortField = query.sortField
  const sortOrder = query.sortOrder ?? 'asc'

  let matched = filterRows(listRows(key), filters)
  if (sortField) {
    const direction = sortOrder === 'desc' ? -1 : 1
    matched = [...matched].sort((a, b) => {
      const va = String(a[sortField] ?? '')
      const vb = String(b[sortField] ?? '')
      if (va === vb) {
        return Number(a.id) - Number(b.id)
      }
      return va < vb ? -direction : direction
    })
  } else {
    matched = [...matched].sort((a, b) => Number(a.id) - Number(b.id))
  }

  const total = matched.length
  const totalPages = Math.max(1, Math.ceil(total / size))
  const requested = query.page ?? 1
  let page = requested
  let notice: string | undefined
  if (!Number.isFinite(page) || page < 1) {
    page = 1
    notice = '页码必须是不小于 1 的正整数，已回到第一页。'
  } else {
    page = Math.floor(page)
    if (total > 0 && page > totalPages) {
      notice = `当前条件下只有 ${totalPages} 页，第 ${requested} 页超出范围，已回到第一页。`
      page = 1
    }
  }
  const start = (page - 1) * size
  return {
    items: matched.slice(start, start + size),
    total,
    page,
    size,
    totalPages: total === 0 ? 1 : totalPages,
    notice,
  }
}

function todayText(): string {
  return new Date().toISOString().slice(0, 10)
}

/** 主变检修列表专用入口：筛选、排序、翻页、页码跳转全部落到同一份规整数据。 */
export function listTransformerEntries(
  filters: Record<string, string>,
  sort: { field: string; order: 'asc' | 'desc' },
  page: number,
): ReturnType<typeof queryTransformerPage> {
  return queryTransformerPage(listRows(TRANSFORMER_KEY), {
    filters,
    sort,
    page,
    size: PAGE_SIZE,
    today: todayText(),
  })
}

/** 详情面板按 id 从同一份规整数据取行，列表与详情的主变名称、工期天然一致。 */
export function getTransformerEntry(id: number): EntryRow | undefined {
  return normalizeTransformerRows(listRows(TRANSFORMER_KEY)).find((row) => Number(row.id) === id)
}

export type TransformerForm = {
  检修编号: string
  主变名称: string
  检修类别: string
  停电范围: string
  检修班组: string
  计划工期: string
  调度批复工期?: string
}

/** 登记主变检修：必填校验 + 同一台主变重复提交拦截，保存仍走同一份规整数据。 */
export function createTransformerEntry(form: TransformerForm): ActionResult {
  const rows = normalizeTransformerRows(listRows(TRANSFORMER_KEY))
  const result = validateNewTransformer(rows, form)
  if (!result.ok) {
    return result
  }
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const row: EntryRow = {
    id,
    status: '待开工',
    pending: true,
    abnormal: false,
    [FIELD_CODE]: form[FIELD_CODE].trim(),
    [FIELD_NAME]: form[FIELD_NAME].trim(),
    [FIELD_CATEGORY]: form[FIELD_CATEGORY].trim(),
    [FIELD_SCOPE]: form[FIELD_SCOPE].trim(),
    [FIELD_TEAM]: form[FIELD_TEAM].trim(),
    [FIELD_PLAN]: form[FIELD_PLAN].trim(),
    [FIELD_APPROVED]: form[FIELD_APPROVED]?.trim() ?? '',
    [FIELD_FINISH]: '',
    检修状态: '',
  }
  saveRows(TRANSFORMER_KEY, [...rows, row])
  return { ok: true, message: `检修记录 ${form[FIELD_CODE].trim()} 已登记，当前状态「待开工」` }
}

export function transformerStatuses(): readonly string[] {
  return TRANSFORMER_STATUSES
}

export function transformerOverdueInfo(row: EntryRow): {
  overdue: boolean
  days: number
  end: string
  source: string
} {
  const today = todayText()
  const schedule = effectiveSchedule(row)
  const overdue = isOverdue(row, today)
  return {
    overdue,
    days: overdue
      ? Math.round((new Date(today).getTime() - new Date(schedule.end).getTime()) / 86400000)
      : 0,
    end: schedule.end,
    source:
      schedule.source === 'approved' ? '调度批复工期' : schedule.source === 'plan' ? '计划工期' : '未登记',
  }
}

export { formatSchedule as formatTransformerSchedule }

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  // 确认完工时把完成日期记成当天；历史记录没填完成日期也不拦截。
  if (key === TRANSFORMER_KEY && target === '已完工' && !String(updated[FIELD_FINISH]).trim()) {
    updated[FIELD_FINISH] = todayText()
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

// ── 超期未完工 → 工作票许可待办理清单 ───────────────────────────────────

/**
 * 超期未完工的主变检修记录进入工作票许可的待办理清单。
 * 已经办过票（工作任务中带该检修编号）的不再重复出现。
 */
export function listOverduePermitTodos(): EntryRow[] {
  const today = todayText()
  const linkedCodes = new Set(
    listRows(WORKPERMIT_KEY)
      .map((permit) => {
        const match = String(permit.工作任务 ?? '').match(/TRAN-\d{4}/)
        return match ? match[0] : ''
      })
      .filter(Boolean),
  )
  return normalizeTransformerRows(listRows(TRANSFORMER_KEY)).filter(
    (row) => isOverdue(row, today) && !linkedCodes.has(String(row[FIELD_CODE])),
  )
}

/** 为超期检修单办理工作票：生成一张「待签发」工作票，随后该单退出待办理清单。 */
export function issueOverduePermit(id: number): ActionResult {
  const today = todayText()
  const row = normalizeTransformerRows(listRows(TRANSFORMER_KEY)).find(
    (item) => Number(item.id) === id,
  )
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的主变检修记录` }
  }
  if (!isOverdue(row, today)) {
    return { ok: false, message: '该检修记录未超期，不在待办理清单中' }
  }
  const code = String(row[FIELD_CODE])
  const permits = listRows(WORKPERMIT_KEY)
  if (permits.some((permit) => String(permit.工作任务 ?? '').includes(code))) {
    return { ok: false, message: `检修单 ${code} 的工作票已办理，不能重复出现在待办理清单` }
  }
  const newId = permits.reduce((max, permit) => Math.max(max, Number(permit.id)), 0) + 1
  const permit: EntryRow = {
    id: newId,
    status: '待签发',
    pending: true,
    abnormal: false,
    工作票号: `WP-${String(newId).padStart(4, '0')}`,
    工作任务: `${PERMIT_TASK_PREFIX}${code} ${String(row[FIELD_NAME])}超期未完工续办`,
    所属变电站: String(row[FIELD_NAME]),
    停电范围: String(row[FIELD_SCOPE]),
    工作负责人: String(row[FIELD_TEAM]),
    许可时间: '',
    终结时间: '',
    许可状态: '',
  }
  saveRows(WORKPERMIT_KEY, [...permits, permit])
  return {
    ok: true,
    message: `已按超期检修单 ${code} 生成待签发工作票 ${String(permit.工作票号)}`,
  }
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
