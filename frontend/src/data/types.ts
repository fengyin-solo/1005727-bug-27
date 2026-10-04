/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

/** 统一的列表查询入参：筛选、排序、分页都走同一份数据，谁也不许自己再排一遍。 */
export type ListQuery = {
  filters?: Record<string, string>
  sortField?: string
  sortOrder?: 'asc' | 'desc'
  page?: number
  size?: number
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
  /** 筛选后数据的总页数，翻页与页码跳转都以此为越界判断依据。 */
  totalPages: number
  /** 请求页码越界时回填实际展示的页码，并给出原因。 */
  notice?: string
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
