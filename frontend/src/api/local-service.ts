import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import {
  allMaintRecords,
  queryMaintRecords,
  TRANSFORMER_MAINT_KEY,
  type MaintQuery,
  type MaintRecord,
} from '@/data/transformer-maint'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

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

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

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
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

// ── 主变检修：排序、翻页、详情、统计都走同一份规范化数据 ──────────────────

export function listMaintEntries(query: MaintQuery = {}) {
  return queryMaintRecords(listRows(TRANSFORMER_MAINT_KEY), query)
}

export function getMaintRecord(id: number): MaintRecord {
  const record = allMaintRecords(listRows(TRANSFORMER_MAINT_KEY)).find(
    (item) => item.id === id,
  )
  if (!record) {
    throw new Error(`没有找到编号为 ${id} 的主变检修记录`)
  }
  return record
}

export type MaintStat = { label: string; value: number }

export function maintStats(): MaintStat[] {
  const records = allMaintRecords(listRows(TRANSFORMER_MAINT_KEY))
  const currentMonth = (() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })()
  return [
    { label: '待开工检修', value: records.filter((item) => item.status === '待开工').length },
    { label: '检修中主变', value: records.filter((item) => item.status === '检修中').length },
    {
      label: '本月完工数',
      value: records.filter((item) => item.完成日期.startsWith(currentMonth)).length,
    },
    { label: '超期未完工', value: records.filter((item) => item.超期).length },
  ]
}

/** 超期未完工的结论反映到工作票许可：形成待办理清单。 */
export function overdueMaintTodo(): MaintRecord[] {
  return allMaintRecords(listRows(TRANSFORMER_MAINT_KEY))
    .filter((item) => item.超期)
    .sort((a, b) => (a.计划完工 || '').localeCompare(b.计划完工 || ''))
}

/** 已为某条超期检修补办过待签发工作票，则待办里不再重复出现办理入口。 */
export function hasPermitForMaint(code: string): boolean {
  const tickets = listRows('workpermit')
  return tickets.some((row) => String(row.关联检修编号 ?? '') === code)
}

export function createOverduePermit(id: number): ActionResult {
  const record = allMaintRecords(listRows(TRANSFORMER_MAINT_KEY)).find(
    (item) => item.id === id,
  )
  if (!record) {
    return { ok: false, message: `没有找到编号为 ${id} 的主变检修记录` }
  }
  if (!record.超期) {
    return { ok: false, message: `${record.检修编号}未超期，无需补办工作票` }
  }
  const tickets = listRows('workpermit')
  if (hasPermitForMaint(record.检修编号)) {
    return { ok: false, message: `${record.检修编号}的超期补办工作票已在待办理清单中` }
  }
  const nextId = tickets.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const ticket: EntryRow = {
    id: nextId,
    status: '待签发',
    pending: true,
    abnormal: true,
    工作票号: `WP-MAINT-${record.检修编号.slice(-4)}`,
    工作任务: `${record.主变名称}${record.检修类别}（超期补办）`,
    所属变电站: record.所属变电站,
    停电范围: record.停电范围,
    工作负责人: '',
    许可时间: '',
    终结时间: '',
    许可状态: '待签发',
    关联检修编号: record.检修编号,
  }
  saveRows('workpermit', [...tickets, ticket])
  return { ok: true, message: `已为超期检修 ${record.检修编号} 补办待签发工作票 ${ticket.工作票号}` }
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  if (key === TRANSFORMER_MAINT_KEY) {
    // 主变检修导出同样走规范化结果：重复提交合并、字段别名归一，和列表一致。
    for (const row of allMaintRecords(listRows(key))) {
      const values = meta.fields.map((field) =>
        field === '检修状态' ? row.status : String(row[field as keyof MaintRecord] ?? ''),
      )
      lines.push([row.id, ...values, row.status].join(','))
    }
  } else {
    for (const row of listRows(key)) {
      lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
    }
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
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
