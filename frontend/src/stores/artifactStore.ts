import { createStore } from 'zustand/vanilla'
import type { Artifact, SitePatch, Stratum, WarehousePatch } from '@/types'
import { emptyWarehouseSide, isDepthOutOfStratum } from '@/types'
import { db, syncAll, syncDelete, syncPut } from '@/hooks/usePersistentStore'

export interface ArtifactState {
  artifacts: Artifact[]
  loaded: boolean
  hydrate: () => Promise<void>
  /** 工地记录员保存：只写工地侧字段，库房侧字段沿用旧记录（新记录先归「未移交」） */
  saveSite: (site: SitePatch, strata: Stratum[]) => Promise<void>
  /** 库房保管员保存：只写登账号、库位与借出，器物编号与出土坐标不动 */
  saveWarehouse: (id: string, patch: WarehousePatch) => Promise<void>
  /** 移交库房：未移交 → 已移交 */
  handover: (id: string) => Promise<void>
  /** 库房确认登账号：待核 → 已确认；深度掉出区间时拒绝并保持待核 */
  confirmAccession: (id: string, strata: Stratum[]) => Promise<string | null>
  /** 办理入库；失败记录原因，返回失败原因或 null */
  checkin: (id: string, strata: Stratum[]) => Promise<string | null>
  /** 入库失败后按库房侧重试：以保管员当前维护的登账号、库位重新校验 */
  retryCheckin: (id: string, strata: Stratum[]) => Promise<string | null>
  /** 地层区间变化后重核：出土深度掉出区间的登账号退回待核 */
  revalidateAccession: (strata: Stratum[]) => Promise<void>
  remove: (id: string) => Promise<void>
  removeByStratum: (stratumId: string) => Promise<void>
}

/** 出土深度掉出所属地层单位区间时，登账号退回待核 */
function applyDepthRule(row: Artifact, strata: Stratum[]): Artifact {
  const stratum = strata.find((item) => item.id === row.stratumId)
  if (stratum && isDepthOutOfStratum(row.z, stratum) && row.accessionStatus !== '待核') {
    return { ...row, accessionStatus: '待核' }
  }
  return row
}

/** 入库校验：全部通过返回 null，否则返回失败原因 */
function checkinErrorOf(row: Artifact, strata: Stratum[]): string | null {
  if (row.handover === '未移交') return '尚未移交库房，不能办理入库'
  if (row.handover === '已入库') return '已入库，无需重复办理'
  if (!row.accessionNo.trim()) return '登账号未填写'
  if (!row.storageLocation.trim()) return '库位未分配'
  const stratum = strata.find((item) => item.id === row.stratumId)
  if (stratum && isDepthOutOfStratum(row.z, stratum)) return '出土深度掉出地层单位区间，登账号已退回待核'
  if (row.accessionStatus !== '已确认') return '登账号待核，请先核对确认'
  return null
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export const artifactStore = createStore<ArtifactState>((set, get) => {
  /** 入库办理：通过则转「已入库」，失败记录原因留待按库房侧重试 */
  const runCheckin = async (id: string, strata: Stratum[]): Promise<string | null> => {
    const prev = get().artifacts.find((item) => item.id === id)
    if (!prev) return '出土物不存在'
    const error = checkinErrorOf(prev, strata)
    const next: Artifact = error
      ? applyDepthRule({ ...prev, checkinError: error }, strata)
      : { ...prev, handover: '已入库', checkinDate: today(), checkinError: '' }
    await syncPut<Artifact>(db.artifacts, next)
    await get().hydrate()
    return error
  }

  return {
    artifacts: [],
    loaded: false,
    hydrate: async () => {
      const artifacts = await syncAll<Artifact>(db.artifacts)
      artifacts.sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN', { numeric: true }))
      set({ artifacts, loaded: true })
    },
    saveSite: async (site, strata) => {
      const prev = get().artifacts.find((item) => item.id === site.id)
      // 记录员只提交工地侧字段；库房侧字段从旧记录保留，不会被这次保存冲掉
      const row = applyDepthRule({ ...emptyWarehouseSide(), ...prev, ...site }, strata)
      await syncPut<Artifact>(db.artifacts, row)
      await get().hydrate()
    },
    saveWarehouse: async (id, patch) => {
      const prev = get().artifacts.find((item) => item.id === id)
      if (!prev) return
      // 保管员只写库房侧字段；登账号变更后需重新核对，实物标签上的器物编号不动
      const accessionChanged = patch.accessionNo.trim() !== prev.accessionNo
      const row: Artifact = {
        ...prev,
        accessionNo: patch.accessionNo.trim(),
        storageLocation: patch.storageLocation.trim(),
        loanTo: patch.loanTo.trim(),
        loanDate: patch.loanDate,
        accessionStatus: accessionChanged ? '待核' : prev.accessionStatus
      }
      await syncPut<Artifact>(db.artifacts, row)
      await get().hydrate()
    },
    handover: async (id) => {
      const prev = get().artifacts.find((item) => item.id === id)
      if (!prev || prev.handover !== '未移交') return
      await syncPut<Artifact>(db.artifacts, { ...prev, handover: '已移交', handoverDate: today() })
      await get().hydrate()
    },
    confirmAccession: async (id, strata) => {
      const prev = get().artifacts.find((item) => item.id === id)
      if (!prev) return '出土物不存在'
      if (!prev.accessionNo.trim()) return '登账号未填写，无法确认'
      const stratum = strata.find((item) => item.id === prev.stratumId)
      if (stratum && isDepthOutOfStratum(prev.z, stratum)) {
        if (prev.accessionStatus !== '待核') {
          await syncPut<Artifact>(db.artifacts, { ...prev, accessionStatus: '待核' })
          await get().hydrate()
        }
        return `出土深度 ${prev.z} m 掉出单位「${stratum.code}」的深度区间，登账号保持待核`
      }
      await syncPut<Artifact>(db.artifacts, { ...prev, accessionStatus: '已确认' })
      await get().hydrate()
      return null
    },
    checkin: async (id, strata) => runCheckin(id, strata),
    retryCheckin: async (id, strata) => {
      const prev = get().artifacts.find((item) => item.id === id)
      if (!prev) return '出土物不存在'
      if (!prev.checkinError) return '无入库失败记录，可直接办理入库'
      return runCheckin(id, strata)
    },
    revalidateAccession: async (strata) => {
      const current = get().artifacts
      const changed = current.map((row) => applyDepthRule(row, strata)).filter((row, index) => row !== current[index])
      if (changed.length === 0) return
      await Promise.all(changed.map((row) => syncPut<Artifact>(db.artifacts, row)))
      await get().hydrate()
    },
    remove: async (id) => {
      await syncDelete<Artifact>(db.artifacts, id)
      await get().hydrate()
    },
    removeByStratum: async (stratumId) => {
      const targets = get().artifacts.filter((item) => item.stratumId === stratumId)
      await Promise.all(targets.map((item) => syncDelete<Artifact>(db.artifacts, item.id)))
      await get().hydrate()
    }
  }
})
