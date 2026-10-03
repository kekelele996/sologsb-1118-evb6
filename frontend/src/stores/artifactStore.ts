import { createStore } from 'zustand/vanilla'
import type { Artifact, WarehouseStatus } from '@/types'
import { db, syncAll, syncDelete, syncPut } from '@/hooks/usePersistentStore'
import { stratumStore } from './stratumStore'

/** 取器物库房状态：旧数据无入库信息时归为「未移交」 */
export function warehouseStatusOf(artifact: Artifact): WarehouseStatus {
  return artifact.warehouseStatus ?? '未移交'
}

/** 出土深度是否落在所属地层单位区间内（库房入库核对用） */
function depthInStratum(artifact: Artifact): boolean {
  const stratum = stratumStore.getState().strata.find((item) => item.id === artifact.stratumId)
  if (!stratum) return false
  return artifact.z >= stratum.topDepth && artifact.z <= stratum.bottomDepth
}

export interface ArtifactState {
  artifacts: Artifact[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (artifact: Artifact) => Promise<void>
  remove: (id: string) => Promise<void>
  removeByStratum: (stratumId: string) => Promise<void>
  /** 库房保管员入库：分配登账号与库位；深度掉出区间则登账号退回、状态置「待核」 */
  warehouseIn: (id: string, accessionNo: string, warehouseLocation: string) => Promise<WarehouseStatus>
  /** 库位借出 / 归还（仅动库房字段，不碰器物编号与出土坐标） */
  setLoan: (id: string, onLoan: boolean) => Promise<void>
}

export const artifactStore = createStore<ArtifactState>((set, get) => ({
  artifacts: [],
  loaded: false,
  hydrate: async () => {
    const artifacts = await syncAll<Artifact>(db.artifacts)
    artifacts.sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN', { numeric: true }))
    set({ artifacts, loaded: true })
  },
  save: async (artifact) => {
    const existing = get().artifacts.find((item) => item.id === artifact.id)
    // 记录员只维护器物编号与出土坐标等现场信息；库房字段原样保留，不被临时存放改动带偏
    const next: Artifact = {
      ...artifact,
      accessionNo: existing?.accessionNo,
      warehouseLocation: existing?.warehouseLocation,
      onLoan: existing?.onLoan ?? false,
      warehouseStatus: existing?.warehouseStatus ?? '未移交'
    }
    await syncPut<Artifact>(db.artifacts, next)
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
  },
  warehouseIn: async (id, accessionNo, warehouseLocation) => {
    const target = get().artifacts.find((item) => item.id === id)
    if (!target) return '未移交'
    const inRange = depthInStratum(target)
    const next: Artifact = {
      ...target,
      // 器物编号（实物标签）保持不变；登账号是库房新号，不顶掉 code
      accessionNo: inRange ? accessionNo.trim() : undefined,
      warehouseLocation: inRange ? warehouseLocation.trim() : target.warehouseLocation,
      warehouseStatus: inRange ? '已入库' : '待核'
    }
    await syncPut<Artifact>(db.artifacts, next)
    await get().hydrate()
    return next.warehouseStatus as WarehouseStatus
  },
  setLoan: async (id, onLoan) => {
    const target = get().artifacts.find((item) => item.id === id)
    if (!target) return
    await syncPut<Artifact>(db.artifacts, { ...target, onLoan })
    await get().hydrate()
  }
}))
