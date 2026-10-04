import { SEED_ROWS } from './seed'
import { MODULE_BY_KEY } from './modules'
import { normalizeTransformerRows, TRANSFORMER_KEY } from './transformermaint'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'substation-protection:entries'

// 模块级数据规整：读取既有记录时统一跑一遍，兼容历史写法、去重、补齐新字段。
const MIGRATORS: Record<string, (rows: EntryRow[]) => EntryRow[]> = {
  [TRANSFORMER_KEY]: normalizeTransformerRows,
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * 判断是否为仓库初始化时的占位样例（字段值大量重复「xx样例N」）。
 * 这类存量数据不能按 id 覆盖新版示例：把它作为历史记录保留下来并让位给新示例。
 */
function isPlaceholderSeedRow(row: EntryRow): boolean {
  const values = Object.values(row).filter((value) => typeof value === 'string')
  if (values.length < 5) {
    return false
  }
  const hits = values.filter((value) => /样例\d+$/.test(value)).length
  return hits >= 4
}

/**
 * 合并示例数据与浏览器里的存量数据：
 * 新版示例按 id 播种；用户存量中同 id 的真实改动优先覆盖；
 * 早期占位样例不丢，改挂到 1001 之后作为历史记录保留；最后跑模块规整逻辑，
 * 让同一台主变重复记录只留一条、历史记录补齐调度批复工期等新字段。
 */
function buildMerged(saved: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  const merged: Record<string, EntryRow[]> = {}
  const keys = new Set([...Object.keys(SEED_ROWS), ...Object.keys(saved)])
  for (const key of keys) {
    const seedRows = SEED_ROWS[key] ?? []
    const savedRows = saved[key] ?? []
    const byId = new Map<number, EntryRow>()
    const legacyRows: EntryRow[] = []
    for (const row of seedRows) {
      byId.set(Number(row.id), clone(row))
    }
    for (const savedRow of savedRows) {
      const id = Number(savedRow.id)
      if (isPlaceholderSeedRow(savedRow)) {
        legacyRows.push(clone(savedRow))
      } else {
        byId.set(id, clone(savedRow))
      }
    }
    let nextLegacyId = 1001
    // 各模块首列即编号字段（检修编号、工作票号等），旧占位单编号加后缀，避免与新示例撞号。
    const codeField = MODULE_BY_KEY.get(key)?.fields[0]
    for (const legacy of legacyRows) {
      while (byId.has(nextLegacyId)) {
        nextLegacyId += 1
      }
      const migrated: EntryRow = { ...legacy, id: nextLegacyId }
      if (codeField && typeof migrated[codeField] === 'string') {
        migrated[codeField] = `${migrated[codeField]}（历史）`
      }
      byId.set(nextLegacyId, migrated)
      nextLegacyId += 1
    }
    const rows = [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id))
    merged[key] = MIGRATORS[key] ? MIGRATORS[key](rows) : rows
  }
  return merged
}

function persist(data: Record<string, EntryRow[]>): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }
}

function readStorage(): Record<string, EntryRow[]> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return buildMerged({})
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const seeded = buildMerged({})
    persist(seeded)
    return seeded
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    const merged = buildMerged(parsed)
    // 规整后写回：重复记录被清掉、新增示例补齐，下次读取就是干净数据。
    persist(merged)
    return merged
  } catch {
    const seeded = buildMerged({})
    persist(seeded)
    return seeded
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const migrator = MIGRATORS[key]
  const normalized = migrator ? migrator(rows) : rows
  const next = { ...allRows(), [key]: normalized }
  cache = next
  persist(next)
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return listRows(key)
}

export function storageKey(): string {
  return STORAGE_KEY
}
