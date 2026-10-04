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
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <section class="todo-panel">
      <h3 class="todo-title">工作票许可待办理清单（超期未完工主变检修）</h3>
      <p class="todo-desc">
        超期判定以调度批复工期为准、无批复时按计划工期，已完工不计；已办过票的检修单不再重复出现。
      </p>
      <table v-if="todoRows.length" class="data-table">
        <thead>
          <tr>
            <th>检修编号</th>
            <th>主变名称</th>
            <th>检修类别</th>
            <th>当前状态</th>
            <th>工期截止</th>
            <th>超期天数</th>
            <th>办理</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in todoRows" :key="`todo-${row.id}`">
            <td>{{ row['检修编号'] }}</td>
            <td>{{ row['主变名称'] }}</td>
            <td>{{ row['检修类别'] }}</td>
            <td>{{ row.status }}</td>
            <td>{{ overdueInfo(row).end }}（{{ overdueInfo(row).source }}）</td>
            <td><span class="tag tag-overdue">超期{{ overdueInfo(row).days }}天</span></td>
            <td class="row-actions">
              <button class="link" type="button" @click="issueTodo(row)">办理工作票</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty-state todo-empty">暂无超期未完工的主变检修记录，待办理清单为空</p>
    </section>

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
        <tr v-for="row in rows" :key="String(row.id)">
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
  downloadEntries,
  issueOverduePermit,
  listEntries,
  listOverduePermitTodos,
  moduleMeta,
  runAction as applyAction,
  transformerOverdueInfo,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('workpermit')
const columns = ["工作票号", "工作任务", "所属变电站", "停电范围", "工作负责人", "许可时间", "终结时间", "许可状态"]
const actions = ["签发许可", "办理终结", "作废工作票"]
const statuses = ["待签发", "已许可", "已终结", "已作废"]
const stats = [{"label": "待签发工作票", "value": 0}, {"label": "已许可工作票", "value": 0}, {"label": "已终结工作票", "value": 0}]

const rows = ref<EntryRow[]>([])
const todoRows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function overdueInfo(row: EntryRow) {
  return transformerOverdueInfo(row)
}

function refreshTodos() {
  // 超期未完工的结论直接反映到工作票许可的待办理清单。
  todoRows.value = listOverduePermitTodos()
}

function issueTodo(row: EntryRow) {
  errorMessage.value = ''
  const result = issueOverduePermit(Number(row.id))
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  errorMessage.value = result.message
  refreshTodos()
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
    refreshTodos()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '工作票许可列表读取失败'
  }
}

onMounted(reload)
</script>
