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
      <article
        v-for="item in stats"
        :key="item.label"
        class="stat-card"
        :class="{ 'stat-alert': item.label === '超期未完工' && item.value > 0 }"
      >
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="search">
      <label v-for="field in filterFields" :key="field.name" class="filter-item">
        <span>{{ field.label }}</span>
        <input
          v-model="filters[field.name]"
          :placeholder="field.placeholder"
          @keydown.enter.prevent="search"
        />
      </label>
      <label class="filter-item">
        <span>检修状态</span>
        <select v-model="filters['检修状态']">
          <option value="">全部</option>
          <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <p v-if="infoMessage" class="notice-text">{{ infoMessage }}</p>

    <table class="data-table">
      <thead>
        <tr>
          <th
            v-for="column in sortableColumns"
            :key="column.name"
            class="sortable-head"
            @click="toggleSort(column.name)"
          >
            {{ column.label }}
            <span class="sort-mark">{{ sortMark(column.name) }}</span>
          </th>
          <th
            v-for="column in fixedColumns"
            :key="column"
          >
            {{ column }}
          </th>
          <th>超期标记</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-overdue': row.超期 }">
          <td>{{ row.检修编号 || '—' }}</td>
          <td>
            <button class="link" type="button" @click="openDetail(row)">{{ row.主变名称 || '—' }}</button>
          </td>
          <td>{{ row.检修类别 || '—' }}</td>
          <td>{{ row.计划工期 || '—' }}</td>
          <td>{{ row.完成日期 || '—' }}</td>
          <td>{{ row.所属变电站 || '—' }}</td>
          <td>{{ row.停电范围 || '—' }}</td>
          <td>{{ row.检修班组 || '—' }}</td>
          <td>{{ row.调度批复工期 || '—' }}</td>
          <td>{{ row.status }}</td>
          <td>
            <span v-if="row.超期" class="overdue-tag">超期未完工</span>
            <span v-else>正常</span>
          </td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">查看详情</button>
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columnCount" class="empty-state">当前条件下暂无主变检修记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条主变检修记录，第 {{ page }} / {{ totalPages }} 页</span>
      <div class="pager">
        <button class="btn" type="button" :disabled="page <= 1" @click="gotoPage(page - 1)">上一页</button>
        <button
          v-for="p in pageNumbers"
          :key="p"
          class="btn"
          :class="{ primary: p === page }"
          type="button"
          @click="gotoPage(p)"
        >
          {{ p }}
        </button>
        <button
          class="btn"
          type="button"
          :disabled="page >= totalPages"
          @click="gotoPage(page + 1)"
        >
          下一页
        </button>
        <label class="jump-item">
          跳至
          <input v-model.number="jumpPage" type="number" min="1" @keydown.enter.prevent="jump" />
          页
        </label>
        <button class="btn" type="button" @click="jump">跳转</button>
      </div>
    </footer>
    <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>

    <div v-if="detail" class="detail-mask" @click.self="closeDetail">
      <article class="detail-panel">
        <header class="detail-head">
          <h3>主变检修详情</h3>
          <button class="btn ghost" type="button" @click="closeDetail">关闭</button>
        </header>
        <dl class="detail-grid">
          <template v-for="item in detailItems" :key="item.label">
            <dt>{{ item.label }}</dt>
            <dd :class="{ 'dd-overdue': item.overdue }">{{ item.value }}</dd>
          </template>
        </dl>
        <p v-if="detail.超期" class="overdue-conclusion">
          结论：该记录已超过{{ detail.调度批复工期 ? '调度批复' : '计划' }}工期且尚未完工，
          已反映到工作票许可的待办理清单，请尽快补办工作票。
        </p>
        <p v-if="detail.工期说明" class="detail-note">工期口径：{{ detail.工期说明 }}。</p>
        <p v-if="detail.合并记录.length" class="detail-note">
          同一台主变重复提交的记录已合并：{{ detail.合并记录.join('、') }} 并入 {{ detail.检修编号 }}。
        </p>
        <footer class="detail-actions">
          <button
            v-for="action in actions"
            :key="action"
            class="btn"
            type="button"
            @click="runAction(action, detail)"
          >
            {{ action }}
          </button>
        </footer>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  getMaintRecord,
  listMaintEntries,
  maintStats,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { MaintRecord } from '@/data/transformer-maint'

const meta = moduleMeta('transformermaint')
// 列表列顺序固定，避免翻页时主变名称与计划工期错位。
const sortableColumns = [
  { name: '检修编号', label: '检修编号' },
  { name: '主变名称', label: '主变名称' },
  { name: '检修类别', label: '检修类别' },
  { name: '计划工期', label: '计划工期' },
  { name: '完成日期', label: '完成日期' },
] as const
const fixedColumns = ['所属变电站', '停电范围', '检修班组', '调度批复工期', '当前状态']
const columnCount = sortableColumns.length + fixedColumns.length + 2
const actions = meta.actions
const statuses = meta.statuses

const filterFields = [
  { name: '检修编号', label: '检修编号', placeholder: '按检修编号精确查询，如 TRAN-0012' },
  { name: '主变名称', label: '主变名称', placeholder: '按主变名称检索' },
  { name: '检修类别', label: '检修类别', placeholder: '按检修类别检索' },
] as const

const rows = ref<MaintRecord[]>([])
const total = ref(0)
const page = ref(1)
const totalPages = ref(1)
const sortBy = ref<string>('检修编号')
const sortDir = ref<'asc' | 'desc'>('asc')
const jumpPage = ref<number | null>(null)
const errorMessage = ref('')
const infoMessage = ref('')
const filters = ref<Record<string, string>>({ 检修编号: '', 主变名称: '', 检修类别: '', 检修状态: '' })
const detail = ref<MaintRecord | null>(null)
const stats = ref(maintStats())
const statusCount = ref<Record<string, number>>({})

// 图例按筛选后的完整结果计数，不受当前页只显示十条影响。
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: statusCount.value[status] ?? 0,
  })),
)

// 页码按钮：当前页前后各两页，避免数据多时按钮铺满一行。
const pageNumbers = computed(() => {
  const pages: number[] = []
  const start = Math.max(1, page.value - 2)
  const end = Math.min(totalPages.value, start + 4)
  for (let p = Math.max(1, end - 4); p <= end; p += 1) {
    pages.push(p)
  }
  return pages
})

const detailItems = computed(() => {
  const record = detail.value
  if (!record) {
    return []
  }
  return [
    { label: '检修编号', value: record.检修编号 || '—' },
    { label: '主变名称', value: record.主变名称 || '—' },
    { label: '所属变电站', value: record.所属变电站 || '—' },
    { label: '检修类别', value: record.检修类别 || '—' },
    { label: '停电范围', value: record.停电范围 || '—' },
    { label: '检修班组', value: record.检修班组 || '—' },
    { label: '当前状态', value: record.status },
    { label: '计划工期', value: record.计划工期 || '—' },
    { label: '调度批复工期', value: record.调度批复工期 || '无' },
    { label: '生效工期', value: record.生效工期 || '—', overdue: record.超期 },
    { label: '完成日期', value: record.完成日期 || '未完工', overdue: false },
    {
      label: '超期结论',
      value: record.超期 ? '超期未完工，已进入工作票待办理清单' : '未超期',
      overdue: record.超期,
    },
  ]
})

function sortMark(name: string): string {
  if (sortBy.value !== name) {
    return '⇅'
  }
  return sortDir.value === 'asc' ? '↑' : '↓'
}

function toggleSort(name: string) {
  if (sortBy.value === name) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortBy.value = name
    sortDir.value = 'asc'
  }
  page.value = 1
  reload()
}

// 查询条件变化后回到第一页，条件本身全部保留。
function search() {
  page.value = 1
  reload()
}

function resetFilters() {
  filters.value = { 检修编号: '', 主变名称: '', 检修类别: '', 检修状态: '' }
  page.value = 1
  reload()
}

function gotoPage(target: number) {
  page.value = target
  reload()
}

// 页码越界（含手填非法值）由服务层统一纠正到第一页，并说明原因。
function jump() {
  const target = Number(jumpPage)
  page.value = Number.isFinite(target) ? target : NaN
  jumpPage.value = null
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '主变检修记录登记入口尚未接入审批流'
}

function openDetail(row: MaintRecord) {
  try {
    // 详情与列表取自同一份规范化数据，两处主变名称始终一致。
    detail.value = getMaintRecord(Number(row.id))
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '详情读取失败'
  }
}

function closeDetail() {
  detail.value = null
}

function runAction(action: string, row: MaintRecord) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  if (detail.value && Number(detail.value.id) === Number(row.id)) {
    detail.value = getMaintRecord(Number(row.id))
  }
  stats.value = maintStats()
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listMaintEntries({
      filters: filters.value,
      sortBy: sortBy.value,
      sortDir: sortDir.value,
      page: page.value,
      size: 10,
    })
    rows.value = payload.items
    total.value = payload.total
    page.value = payload.page
    totalPages.value = payload.totalPages
    statusCount.value = payload.statusCount
    infoMessage.value = [payload.notice, ...payload.notices].filter(Boolean).join('；')
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '主变检修列表读取失败'
  }
}

onMounted(reload)
</script>
