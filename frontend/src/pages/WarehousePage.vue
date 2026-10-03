<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { Artifact, HandoverStatus } from '@/types'
import { HANDOVER_STATUSES, isDepthOutOfStratum } from '@/types'
import { useStore } from '@/hooks/usePersistentStore'
import { artifactStore } from '@/stores/artifactStore'
import { stratumStore } from '@/stores/stratumStore'
import { trenchStore } from '@/stores/trenchStore'
import { downloadCsv } from '@/utils/export'

const artifactState = useStore(artifactStore)
const stratumState = useStore(stratumStore)
const trenchState = useStore(trenchStore)

const filterHandover = ref<HandoverStatus | ''>('')
const onlyPending = ref(false)

const dialogVisible = ref(false)
const editingId = ref<string | null>(null)
const form = reactive({
  accessionNo: '',
  storageLocation: '',
  loanTo: '',
  loanDate: ''
})

const editing = computed(() => artifactState.artifacts.find((item) => item.id === editingId.value) ?? null)

function stratumOf(stratumId: string): string {
  return stratumState.strata.find((item) => item.id === stratumId)?.code ?? '未知单位'
}

function trenchOf(stratumId: string): string {
  const stratum = stratumState.strata.find((item) => item.id === stratumId)
  if (!stratum) return '未知探方'
  const trench = trenchState.trenches.find((item) => item.id === stratum.trenchId)
  return trench ? `${trench.area} · ${trench.code}` : '未知探方'
}

/** 出土深度是否掉出所属地层单位区间（登账号须保持待核） */
function depthOut(row: Artifact): boolean {
  const stratum = stratumState.strata.find((item) => item.id === row.stratumId)
  return stratum ? isDepthOutOfStratum(row.z, stratum) : false
}

const editingDepthOut = computed(() => (editing.value ? depthOut(editing.value) : false))

const visible = computed(() =>
  artifactState.artifacts.filter((item) => {
    if (filterHandover.value && item.handover !== filterHandover.value) return false
    if (onlyPending.value && item.accessionStatus !== '待核') return false
    return true
  })
)

const stats = computed(() => ({
  unhanded: artifactState.artifacts.filter((item) => item.handover === '未移交').length,
  handed: artifactState.artifacts.filter((item) => item.handover === '已移交').length,
  checkedIn: artifactState.artifacts.filter((item) => item.handover === '已入库').length,
  pending: artifactState.artifacts.filter((item) => item.accessionStatus === '待核').length,
  onLoan: artifactState.artifacts.filter((item) => item.loanTo).length
}))

const handoverTagType: Record<HandoverStatus, 'info' | 'warning' | 'success'> = {
  未移交: 'info',
  已移交: 'warning',
  已入库: 'success'
}

function openEdit(row: Artifact): void {
  editingId.value = row.id
  Object.assign(form, {
    accessionNo: row.accessionNo,
    storageLocation: row.storageLocation,
    loanTo: row.loanTo,
    loanDate: row.loanDate
  })
  dialogVisible.value = true
}

async function saveWarehouse(): Promise<void> {
  if (!editingId.value) return
  // 只提交库房侧字段；器物编号与出土坐标由记录员维护，这里不动
  await artifactStore.getState().saveWarehouse(editingId.value, { ...form })
  ElMessage.success('库房信息已保存（器物编号与出土坐标未改动）')
  dialogVisible.value = false
}

async function confirmAccession(row: Artifact): Promise<void> {
  const error = await artifactStore.getState().confirmAccession(row.id, stratumState.strata)
  if (error) {
    ElMessage.error(error)
  } else {
    ElMessage.success(`登账号 ${row.accessionNo} 已确认`)
  }
}

async function checkin(row: Artifact): Promise<void> {
  const error = await artifactStore.getState().checkin(row.id, stratumState.strata)
  if (error) {
    ElMessage.error(`入库失败：${error}`)
  } else {
    ElMessage.success(`出土物 ${row.code} 已入库`)
  }
}

async function retry(row: Artifact): Promise<void> {
  const error = await artifactStore.getState().retryCheckin(row.id, stratumState.strata)
  if (error) {
    ElMessage.error(`按库房侧重试仍失败：${error}`)
  } else {
    ElMessage.success(`出土物 ${row.code} 已入库`)
  }
}

async function lend(row: Artifact): Promise<void> {
  const { value } = await ElMessageBox.prompt('借出去向（单位 / 借用人）', `借出 ${row.code}`, {
    inputPlaceholder: '如 省考古所修复室',
    inputValidator: (input: string) => (input && input.trim() ? true : '请填写借出去向'),
    type: 'warning'
  })
  await artifactStore.getState().saveWarehouse(row.id, {
    accessionNo: row.accessionNo,
    storageLocation: row.storageLocation,
    loanTo: String(value).trim(),
    loanDate: new Date().toISOString().slice(0, 10)
  })
  ElMessage.success(`出土物 ${row.code} 已借出`)
}

async function takeBack(row: Artifact): Promise<void> {
  await ElMessageBox.confirm(`确认「${row.code}」已归还回库？`, '归还确认', { type: 'warning' })
  await artifactStore.getState().saveWarehouse(row.id, {
    accessionNo: row.accessionNo,
    storageLocation: row.storageLocation,
    loanTo: '',
    loanDate: ''
  })
  ElMessage.success(`出土物 ${row.code} 已归还`)
}

function exportLedger(): void {
  downloadCsv(
    '库房台账.csv',
    visible.value.map((item) => ({
      code: item.code,
      trench: trenchOf(item.stratumId),
      stratum: stratumOf(item.stratumId),
      handover: item.handover,
      handoverDate: item.handoverDate,
      accessionNo: item.accessionNo,
      accessionStatus: item.accessionStatus,
      storageLocation: item.storageLocation,
      loanTo: item.loanTo,
      loanDate: item.loanDate,
      checkinDate: item.checkinDate,
      checkinError: item.checkinError
    })) as unknown as Record<string, unknown>[],
    [
      { key: 'code', label: '器物编号' },
      { key: 'trench', label: '探方' },
      { key: 'stratum', label: '地层单位' },
      { key: 'handover', label: '移交状态' },
      { key: 'handoverDate', label: '移交日期' },
      { key: 'accessionNo', label: '登账号' },
      { key: 'accessionStatus', label: '登账号状态' },
      { key: 'storageLocation', label: '库位' },
      { key: 'loanTo', label: '借出去向' },
      { key: 'loanDate', label: '借出日期' },
      { key: 'checkinDate', label: '入库日期' },
      { key: 'checkinError', label: '入库失败原因' }
    ]
  )
  ElMessage.success('库房台账已导出')
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2 class="page-title">库房管理（登账号 · 库位 · 借出）</h2>
        <p class="page-sub">
          保管员维护登账号、库位与借出；器物编号与出土坐标由工地记录员维护，实物标签上的编号不会被库房登账号顶掉。
        </p>
      </div>
      <el-button @click="exportLedger">导出库房台账</el-button>
    </div>

    <el-alert
      v-if="stats.pending > 0"
      class="alert"
      type="warning"
      :closable="false"
      show-icon
      :title="`有 ${stats.pending} 件出土物登账号待核：出土深度掉出地层区间会自动退回待核，核对无误后再确认`"
    />

    <div class="toolbar">
      <el-select v-model="filterHandover" placeholder="全部移交状态" clearable style="width: 150px">
        <el-option v-for="item in HANDOVER_STATUSES" :key="item" :label="item" :value="item" />
      </el-select>
      <el-switch v-model="onlyPending" active-text="只看登账号待核" />
      <el-tag type="info" effect="plain">未移交 {{ stats.unhanded }}</el-tag>
      <el-tag type="warning" effect="plain">已移交 {{ stats.handed }}</el-tag>
      <el-tag type="success" effect="plain">已入库 {{ stats.checkedIn }}</el-tag>
      <el-tag v-if="stats.onLoan > 0" type="danger" effect="plain">借出 {{ stats.onLoan }}</el-tag>
    </div>

    <el-table :data="visible" border stripe row-key="id">
      <el-table-column label="器物编号（实物标签）" width="170">
        <template #default="{ row }: { row: Artifact }">
          <span class="mono">{{ row.code }}</span>
        </template>
      </el-table-column>
      <el-table-column label="探方" width="140">
        <template #default="{ row }: { row: Artifact }">
          <span class="mono">{{ trenchOf(row.stratumId) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="地层单位" width="100">
        <template #default="{ row }: { row: Artifact }">
          <span class="mono">{{ stratumOf(row.stratumId) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="出土坐标 (X,Y,Z)" width="150">
        <template #default="{ row }: { row: Artifact }">
          {{ row.x }}, {{ row.y }}, {{ row.z }}
          <el-tag v-if="depthOut(row)" type="danger" size="small" effect="plain">深度出区间</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="移交状态" width="96">
        <template #default="{ row }: { row: Artifact }">
          <el-tag :type="handoverTagType[row.handover]" effect="plain">{{ row.handover }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="登账号" width="130">
        <template #default="{ row }: { row: Artifact }">
          <span class="mono">{{ row.accessionNo || '—' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="登账号状态" width="104">
        <template #default="{ row }: { row: Artifact }">
          <el-tag :type="row.accessionStatus === '已确认' ? 'success' : 'warning'" size="small">
            {{ row.accessionStatus }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="库位" min-width="130">
        <template #default="{ row }: { row: Artifact }">
          <span>{{ row.storageLocation || '—' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="借出" width="170">
        <template #default="{ row }: { row: Artifact }">
          <span v-if="row.loanTo">{{ row.loanTo }} · {{ row.loanDate }}</span>
          <span v-else class="muted">在库</span>
        </template>
      </el-table-column>
      <el-table-column label="入库信息" min-width="170">
        <template #default="{ row }: { row: Artifact }">
          <span v-if="row.handover === '已入库'">已于 {{ row.checkinDate }} 入库</span>
          <span v-else-if="row.checkinError" class="fail">失败：{{ row.checkinError }}</span>
          <span v-else class="muted">—</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="300" fixed="right">
        <template #default="{ row }: { row: Artifact }">
          <el-button link type="primary" size="small" @click="openEdit(row)">库房信息</el-button>
          <el-button
            v-if="row.handover !== '未移交' && row.accessionStatus === '待核'"
            link
            type="warning"
            size="small"
            @click="confirmAccession(row)"
          >
            确认登账号
          </el-button>
          <el-button
            v-if="row.handover === '已移交' && !row.checkinError"
            link
            type="success"
            size="small"
            @click="checkin(row)"
          >
            办理入库
          </el-button>
          <el-button v-if="row.checkinError" link type="danger" size="small" @click="retry(row)">
            按库房侧重试
          </el-button>
          <el-button v-if="row.handover === '已入库' && !row.loanTo" link size="small" @click="lend(row)">借出</el-button>
          <el-button v-if="row.loanTo" link size="small" @click="takeBack(row)">归还</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" title="库房信息（保管员维护）" width="520px">
      <template v-if="editing">
        <div class="site-info">
          <div>
            器物编号（实物标签）：<b class="mono">{{ editing.code }}</b>
          </div>
          <div>出土坐标：X {{ editing.x }} m · Y {{ editing.y }} m · Z {{ editing.z }} m</div>
          <div>所属单位：{{ stratumOf(editing.stratumId) }}（{{ trenchOf(editing.stratumId) }}）</div>
          <p class="muted">以上由工地记录员维护，此处不可修改；实物标签编号不会被登账号顶掉。</p>
        </div>
        <el-alert
          v-if="editingDepthOut"
          class="alert"
          type="error"
          :closable="false"
          show-icon
          title="出土深度掉出所属地层单位区间，登账号保持待核，需记录员核对层位"
        />
        <el-form label-width="90px">
          <el-form-item label="登账号">
            <el-input v-model="form.accessionNo" placeholder="库房登记号，如 KG2026-0002" />
          </el-form-item>
          <el-form-item label="库位">
            <el-input v-model="form.storageLocation" placeholder="如 驻地库房 B 架 3 层" />
          </el-form-item>
          <el-form-item label="借出去向">
            <el-input v-model="form.loanTo" placeholder="空表示在库未借出" />
          </el-form-item>
          <el-form-item label="借出日期">
            <el-date-picker v-model="form.loanDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
          </el-form-item>
        </el-form>
      </template>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveWarehouse">保存库房信息</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.alert {
  margin-bottom: 14px;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.fail {
  color: #c0392b;
  font-size: 12px;
}
.muted {
  color: #8a8073;
}
.site-info {
  padding: 10px 12px;
  margin-bottom: 14px;
  border-radius: 8px;
  background: #f7f4ee;
  font-size: 13px;
  line-height: 1.9;
}
.site-info p {
  margin: 4px 0 0;
  font-size: 12px;
}
</style>
