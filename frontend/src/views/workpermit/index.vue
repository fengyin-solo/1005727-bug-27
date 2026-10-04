<template>
  <section class="page" data-module="workpermit">
    <header class="page-head">
      <div>
        <h2>工作票许可管理</h2>
        <p class="page-desc">维护工作票，围绕工作票号、工作任务、所属变电站、停电范围做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记工作票</button>
        <button class="btn" type="button" @click="exportRows">导出工作票许可清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article
        v-for="item in stats"
        :key="item.label"
        class="stat-card"
        :class="{ 'stat-alert': item.label.includes('待办理') && item.value > 0 }"
      >
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <section class="todo-panel">
      <h3 class="todo-title">待办理清单（主变检修超期未完工）</h3>
      <p class="page-desc">
        主变检修超过调度批复（或计划）工期仍未完工的记录自动进入本清单，需补办工作票许可手续。
      </p>
      <table v-if="todoRows.length" class="data-table">
        <thead>
          <tr>
            <th>检修编号</th>
            <th>主变名称</th>
            <th>所属变电站</th>
            <th>检修类别</th>
            <th>生效工期</th>
            <th>当前状态</th>
            <th>办理</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in todoRows" :key="`todo-${row.id}`" class="row-overdue">
            <td>{{ row.检修编号 }}</td>
            <td>{{ row.主变名称 }}</td>
            <td>{{ row.所属变电站 || '—' }}</td>
            <td>{{ row.检修类别 || '—' }}</td>
            <td>{{ row.生效工期 }}</td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button
                v-if="!permitedCodes.has(row.检修编号)"
                class="link"
                type="button"
                @click="handleOverdue(row)"
              >
                补办工作票
              </button>
              <span v-else class="todo-done">已补办待签发（{{ permitNo(row.检修编号) }}）</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty-state todo-empty">暂无超期未完工的主变检修，无需补办工作票</p>
    </section>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-overdue': row.abnormal && row.status === '待签发' }">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
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
          <td :colspan="columns.length + 2" class="empty-state">暂无工作票许可数据，可先登记工作票</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条工作票许可记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  createOverduePermit,
  downloadEntries,
  hasPermitForMaint,
  listEntries,
  moduleMeta,
  overdueMaintTodo,
  runAction as applyAction,
} from '@/api/local-service'
import { listRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'
import type { MaintRecord } from '@/data/transformer-maint'

const meta = moduleMeta('workpermit')
const columns = ['工作票号', '工作任务', '所属变电站', '停电范围', '工作负责人', '许可时间', '终结时间', '许可状态']
const actions = ['签发许可', '办理终结', '作废工作票']
const statuses = ['待签发', '已许可', '已终结', '已作废']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const todoRows = ref<MaintRecord[]>([])
// listRows 直读 localStorage 不是响应式数据，用版本号驱动待办状态刷新。
const dataVersion = ref(0)

const stats = computed(() => {
  const pending = todoRows.value.length
  return [
    { label: '超期检修待办理', value: pending },
    { label: '待签发工作票', value: rows.value.filter((row) => row.status === '待签发').length },
    { label: '已许可工作票', value: rows.value.filter((row) => row.status === '已许可').length },
    { label: '已终结工作票', value: rows.value.filter((row) => row.status === '已终结').length },
  ]
})

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const permitedCodes = computed(() => {
  void dataVersion.value
  return new Set(
    listRows(meta.key)
      .filter((row) => String(row['关联检修编号'] ?? '') !== '')
      .map((row) => String(row['关联检修编号'])),
  )
})

function permitNo(code: string): string {
  const ticket = listRows(meta.key).find((row) => String(row['关联检修编号'] ?? '') === code)
  return ticket ? String(ticket['工作票号']) : ''
}

function refreshTodo() {
  // 结论由主变检修数据实时计算：完工或删除后自动移出待办理清单。
  todoRows.value = overdueMaintTodo().filter((row) => !hasPermitForMaint(row.检修编号))
}

function handleOverdue(row: MaintRecord) {
  errorMessage.value = ''
  const result = createOverduePermit(Number(row.id))
  if (!result.ok) {
    errorMessage.value = result.message
  }
  reload()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '工作票登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    refreshTodo()
    dataVersion.value += 1
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '工作票许可列表读取失败'
  }
}

onMounted(reload)
</script>
