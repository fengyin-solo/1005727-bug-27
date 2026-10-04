<template>
  <section class="page" data-module="transformermaint">
    <header class="page-head">
      <div>
        <h2>主变检修管理</h2>
        <p class="page-desc">维护主变检修记录，围绕检修编号、主变名称、检修类别、停电范围做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记主变检修记录</button>
        <button class="btn" type="button" @click="exportRows">导出主变检修清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item legend-warn">超期未完工：{{ overdueCount }}</span>
      <span class="legend-tip">超期判定以调度批复工期为准，无批复时按计划工期；已完工不计超期。</span>
    </p>

    <form class="filter-bar" @submit.prevent="search">
      <label class="filter-item">
        <span>检修编号</span>
        <input v-model="filters['检修编号']" placeholder="按检修编号精确查询" />
      </label>
      <label class="filter-item">
        <span>主变名称</span>
        <input v-model="filters['主变名称']" placeholder="按主变名称检索" />
      </label>
      <label class="filter-item">
        <span>检修类别</span>
        <select v-model="filters['检修类别']">
          <option value="">全部类别</option>
          <option v-for="cat in categories" :key="cat" :value="cat">{{ cat }}</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <p v-if="notice" class="notice-text">{{ notice }}</p>

    <table class="data-table">
      <thead>
        <tr>
          <th @click="toggleSort('检修编号')">
            检修编号<span class="sort-mark">{{ sortMark('检修编号') }}</span>
          </th>
          <th @click="toggleSort('主变名称')">
            主变名称<span class="sort-mark">{{ sortMark('主变名称') }}</span>
          </th>
          <th @click="toggleSort('检修类别')">
            检修类别<span class="sort-mark">{{ sortMark('检修类别') }}</span>
          </th>
          <th>停电范围</th>
          <th>检修班组</th>
          <th @click="toggleSort('计划工期')">
            计划工期<span class="sort-mark">{{ sortMark('计划工期') }}</span>
          </th>
          <th>调度批复工期</th>
          <th @click="toggleSort('完成日期')">
            完成日期<span class="sort-mark">{{ sortMark('完成日期') }}</span>
          </th>
          <th>当前状态</th>
          <th>超期标记</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="`row-${row.id}`" :class="{ 'row-overdue': overdueMap.get(Number(row.id)) }">
          <td>{{ row['检修编号'] }}</td>
          <td>{{ row['主变名称'] }}</td>
          <td>
            <span v-if="isLegacy(row['检修类别'])" class="tag tag-legacy">待补录</span>
            <template v-else>{{ row['检修类别'] }}</template>
          </td>
          <td>
            <span v-if="isLegacy(row['停电范围'])" class="tag tag-legacy">待补录</span>
            <template v-else>{{ row['停电范围'] }}</template>
          </td>
          <td>{{ row['检修班组'] }}</td>
          <td>
            <span v-if="isLegacy(row['计划工期'])" class="tag tag-legacy">待补录</span>
            <template v-else>{{ formatSchedule(String(row['计划工期'])) }}</template>
          </td>
          <td>
            <template v-if="String(row['调度批复工期'] ?? '').trim()">
              <span class="approved-mark">批复</span>{{ formatSchedule(String(row['调度批复工期'])) }}
            </template>
            <span v-else class="muted-text">未批复，按计划工期</span>
          </td>
          <td>{{ String(row['完成日期'] ?? '').trim() || '—' }}</td>
          <td>{{ row.status }}</td>
          <td>
            <span v-if="overdueMap.get(Number(row.id))" class="tag tag-overdue">
              超期{{ overdueDaysMap.get(Number(row.id)) }}天
            </span>
            <span v-else class="muted-text">正常</span>
          </td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">查看详情</button>
            <button
              v-for="action in actions"
              :key="`act-${row.id}-${action}`"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="11" class="empty-state">当前条件下没有主变检修记录，可调整查询条件或登记新记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot pager-bar">
      <span>共 {{ total }} 条主变检修记录，第 {{ page }} / {{ totalPages }} 页</span>
      <span class="pager-controls">
        <button class="btn" type="button" :disabled="page <= 1" @click="goPage(1)">首页</button>
        <button class="btn" type="button" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
        <button
          v-for="p in pageNumbers"
          :key="`p-${p}`"
          class="btn"
          :class="{ primary: p === page }"
          type="button"
          @click="goPage(p)"
        >
          {{ p }}
        </button>
        <button class="btn" type="button" :disabled="page >= totalPages" @click="goPage(page + 1)">下一页</button>
        <button class="btn" type="button" :disabled="page >= totalPages" @click="goPage(totalPages)">末页</button>
        <label class="jump-item">
          跳至
          <input v-model="jumpPage" class="jump-input" type="number" min="1" @keydown.enter.prevent="jump" />
          页
        </label>
        <button class="btn" type="button" @click="jump">跳转</button>
      </span>
    </footer>

    <!-- 详情面板：字段与列表同源，主变名称、工期不会两处不一致 -->
    <div v-if="detailRow" class="modal-mask" @click.self="closeDetail">
      <div class="modal-panel">
        <header class="modal-head">
          <h3>主变检修记录详情</h3>
          <button class="link" type="button" @click="closeDetail">关闭</button>
        </header>
        <dl class="detail-grid">
          <template v-for="item in detailItems" :key="item.label">
            <dt>{{ item.label }}</dt>
            <dd :class="{ 'cell-overdue': item.overdue }">{{ item.value }}</dd>
          </template>
          <dt>当前状态</dt>
          <dd>{{ detailRow.status }}</dd>
          <dt>超期结论</dt>
          <dd>
            <span v-if="detailOverdue" class="tag tag-overdue">
              超期未完工（以{{ detailOverdueSource }}为准，已超 {{ detailOverdueDays }} 天）
            </span>
            <span v-else-if="detailRow.status === '已完工'" class="muted-text">已完工，不判定超期</span>
            <span v-else class="muted-text">工期内，未超期</span>
          </dd>
        </dl>
        <p class="detail-tip">工期冲突时一律以调度批复工期为准；调度未批复的按计划工期执行。</p>
      </div>
    </div>

    <!-- 登记弹窗：检修类别与计划工期必填，同主变重复提交只保留/允许一条 -->
    <div v-if="creating" class="modal-mask" @click.self="closeCreate">
      <div class="modal-panel">
        <header class="modal-head">
          <h3>登记主变检修记录</h3>
          <button class="link" type="button" @click="closeCreate">关闭</button>
        </header>
        <form class="create-form" @submit.prevent="submitCreate">
          <label v-for="field in createFields" :key="field" class="create-item">
            <span>{{ field }}<em v-if="isRequired(field)">*</em></span>
            <input
              v-if="field !== '检修类别'"
              v-model="createForm[field]"
              :placeholder="field === '计划工期' ? '如 2026-10-08 至 2026-10-09' : `请填写${field}`"
            />
            <select v-else v-model="createForm['检修类别']">
              <option value="" disabled>请选择检修类别</option>
              <option v-for="cat in categories" :key="cat" :value="cat">{{ cat }}</option>
            </select>
          </label>
          <p v-if="formError" class="error-text">{{ formError }}</p>
          <footer class="modal-actions">
            <button class="btn" type="button" @click="closeCreate">取消</button>
            <button class="btn primary" type="submit">提交登记</button>
          </footer>
        </form>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  createTransformerEntry,
  downloadEntries,
  formatTransformerSchedule,
  getTransformerEntry,
  listTransformerEntries,
  moduleMeta,
  runAction as applyAction,
  transformerOverdueInfo,
  transformerStatuses,
} from '@/api/local-service'
import {
  FIELD_APPROVED,
  FIELD_CATEGORY,
  FIELD_CODE,
  FIELD_FINISH,
  FIELD_NAME,
  FIELD_PLAN,
  FIELD_SCOPE,
  FIELD_TEAM,
  LEGACY_PLACEHOLDER,
  MAINT_CATEGORIES,
} from '@/data/transformermaint'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('transformermaint')
const actions = ['提交开工', '确认完工', '申请延期']
const statuses = [...transformerStatuses()]
const categories = MAINT_CATEGORIES
const createFields = [
  FIELD_CODE,
  FIELD_NAME,
  FIELD_CATEGORY,
  FIELD_SCOPE,
  FIELD_TEAM,
  FIELD_PLAN,
  FIELD_APPROVED,
]
const requiredFields = [FIELD_CODE, FIELD_NAME, FIELD_CATEGORY, FIELD_SCOPE, FIELD_TEAM, FIELD_PLAN]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const page = ref(1)
const totalPages = ref(1)
const notice = ref('')
const filters = ref<Record<string, string>>({ 检修编号: '', 主变名称: '', 检修类别: '' })
const sort = ref<{ field: string; order: 'asc' | 'desc' }>({ field: FIELD_CODE, order: 'asc' })
const jumpPage = ref('')
const overdueMap = ref(new Map<number, boolean>())
const overdueDaysMap = ref(new Map<number, number>())
const statusCounts = ref<Record<string, number>>({})
const overdueCount = ref(0)
const monthFinishedCount = ref(0)

const stats = computed(() => [
  { label: '待开工检修', value: statusCounts.value['待开工'] ?? 0 },
  { label: '检修中主变', value: statusCounts.value['检修中'] ?? 0 },
  { label: '本月完工数', value: monthFinishedCount.value },
  { label: '超期未完工', value: overdueCount.value },
])

const statusSummary = computed(() =>
  statuses.map((status) => ({ status, count: statusCounts.value[status] ?? 0 })),
)

// 页码按钮最多展示 5 个，围绕当前页展开。
const pageNumbers = computed(() => {
  const pages: number[] = []
  const start = Math.max(1, Math.min(page.value - 2, totalPages.value - 4))
  const end = Math.min(totalPages.value, start + 4)
  for (let p = Math.max(1, end - 4); p <= end; p += 1) {
    pages.push(p)
  }
  return pages
})

function collectOverdue(items: EntryRow[]) {
  const map = new Map<number, boolean>()
  const daysMap = new Map<number, number>()
  for (const row of items) {
    const info = transformerOverdueInfo(row)
    map.set(Number(row.id), info.overdue)
    daysMap.set(Number(row.id), info.days)
  }
  overdueMap.value = map
  overdueDaysMap.value = daysMap
}

/** 唯一的数据装载函数：查询、翻页、排序、动作后都走它，条件不丢、数据同源。 */
function reload() {
  const payload = listTransformerEntries(filters.value, sort.value, page.value)
  rows.value = payload.items
  total.value = payload.total
  totalPages.value = payload.totalPages
  statusCounts.value = payload.statusCounts
  overdueCount.value = payload.overdueUnfinished
  monthFinishedCount.value = payload.monthFinished
  collectOverdue(payload.items)
  if (payload.page !== page.value) {
    // 页码越界：服务端已回到第一页，同步本地页码并说明原因。
    page.value = payload.page
  }
  notice.value = payload.notice ?? ''
}

function search() {
  page.value = 1
  reload()
}

function resetFilters() {
  filters.value = { 检修编号: '', 主变名称: '', 检修类别: '' }
  sort.value = { field: FIELD_CODE, order: 'asc' }
  page.value = 1
  notice.value = ''
  reload()
}

function toggleSort(field: string) {
  if (sort.value.field === field) {
    sort.value = { field, order: sort.value.order === 'asc' ? 'desc' : 'asc' }
  } else {
    sort.value = { field, order: 'asc' }
  }
  page.value = 1
  reload()
}

function sortMark(field: string): string {
  if (sort.value.field !== field) {
    return ''
  }
  return sort.value.order === 'asc' ? ' ▲' : ' ▼'
}

function goPage(target: number) {
  if (target === page.value || target < 1 || target > totalPages.value) {
    return
  }
  page.value = target
  reload()
}

function jump() {
  const target = Number(jumpPage.value)
  if (!jumpPage.value.trim() || !Number.isInteger(target) || target < 1) {
    page.value = 1
    notice.value = '页码必须是不小于 1 的正整数，已回到第一页。'
    jumpPage.value = ''
    reload()
    return
  }
  if (target > totalPages.value) {
    page.value = 1
    notice.value = `当前条件下只有 ${totalPages.value} 页，第 ${target} 页超出范围，已回到第一页。`
    jumpPage.value = ''
    reload()
    return
  }
  page.value = target
  jumpPage.value = ''
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function runAction(action: string, row: EntryRow) {
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    notice.value = result.message
    return
  }
  notice.value = result.message
  reload()
}

function isLegacy(value: unknown): boolean {
  return String(value ?? '') === LEGACY_PLACEHOLDER
}

function formatSchedule(text: string): string {
  return formatTransformerSchedule(text)
}

// ── 详情面板 ────────────────────────────────────────────────
const detailId = ref<number | null>(null)
const detailRow = ref<EntryRow | null>(null)

const detailItems = computed<{ label: string; value: string; overdue?: boolean }[]>(() => {
  const row = detailRow.value
  if (!row) {
    return []
  }
  const planText = isLegacy(row[FIELD_PLAN])
    ? LEGACY_PLACEHOLDER
    : formatSchedule(String(row[FIELD_PLAN]))
  const approved = String(row[FIELD_APPROVED] ?? '').trim()
  return [
    { label: FIELD_CODE, value: String(row[FIELD_CODE]) },
    { label: FIELD_NAME, value: String(row[FIELD_NAME]) },
    {
      label: FIELD_CATEGORY,
      value: isLegacy(row[FIELD_CATEGORY]) ? LEGACY_PLACEHOLDER : String(row[FIELD_CATEGORY]),
    },
    { label: FIELD_SCOPE, value: String(row[FIELD_SCOPE]) },
    { label: FIELD_TEAM, value: String(row[FIELD_TEAM]) },
    { label: FIELD_PLAN, value: planText },
    {
      label: FIELD_APPROVED,
      value: approved
        ? `${formatSchedule(approved)}（与计划工期冲突时以此为准）`
        : '未批复，按计划工期执行',
    },
    { label: FIELD_FINISH, value: String(row[FIELD_FINISH] ?? '').trim() || '—' },
  ]
})

const detailOverdue = computed(() =>
  detailRow.value ? transformerOverdueInfo(detailRow.value).overdue : false,
)
const detailOverdueDays = computed(() =>
  detailRow.value ? transformerOverdueInfo(detailRow.value).days : 0,
)
const detailOverdueSource = computed(() =>
  detailRow.value ? transformerOverdueInfo(detailRow.value).source : '',
)

function openDetail(row: EntryRow) {
  // 详情每次都从同一份规整数据里按 id 取，列表与详情的主变名称保持一致。
  detailId.value = Number(row.id)
  detailRow.value = getTransformerEntry(detailId.value as number) ?? null
}

function closeDetail() {
  detailId.value = null
  detailRow.value = null
}

// ── 登记弹窗 ────────────────────────────────────────────────
const creating = ref(false)
const formError = ref('')
const createForm = reactive<Record<string, string>>({
  [FIELD_CODE]: '',
  [FIELD_NAME]: '',
  [FIELD_CATEGORY]: '',
  [FIELD_SCOPE]: '',
  [FIELD_TEAM]: '',
  [FIELD_PLAN]: '',
  [FIELD_APPROVED]: '',
})

function isRequired(field: string): boolean {
  return requiredFields.includes(field)
}

function openCreate() {
  formError.value = ''
  for (const field of createFields) {
    createForm[field] = ''
  }
  creating.value = true
}

function closeCreate() {
  creating.value = false
  formError.value = ''
}

function submitCreate() {
  const result = createTransformerEntry({
    [FIELD_CODE]: createForm[FIELD_CODE],
    [FIELD_NAME]: createForm[FIELD_NAME],
    [FIELD_CATEGORY]: createForm[FIELD_CATEGORY],
    [FIELD_SCOPE]: createForm[FIELD_SCOPE],
    [FIELD_TEAM]: createForm[FIELD_TEAM],
    [FIELD_PLAN]: createForm[FIELD_PLAN],
    [FIELD_APPROVED]: createForm[FIELD_APPROVED],
  })
  if (!result.ok) {
    formError.value = result.message
    return
  }
  creating.value = false
  // 登记成功后回到第一页并保留当前条件，确保新记录按编号排序后能定位到。
  page.value = 1
  notice.value = result.message
  reload()
}

onMounted(reload)
</script>
