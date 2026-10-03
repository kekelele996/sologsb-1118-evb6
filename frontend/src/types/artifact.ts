import type { Stratum } from './stratum'

/** 器物类别 */
export const ARTIFACT_CATEGORIES = ['陶器', '瓷器', '石器', '骨器', '铜器'] as const
export type ArtifactCategory = (typeof ARTIFACT_CATEGORIES)[number]

/** 残整程度 */
export const COMPLETENESS = ['完整', '可复原', '残片'] as const
export type Completeness = (typeof COMPLETENESS)[number]

/** 移交状态：出土物先放工地临时柜，回驻地后移交库房、入库上架 */
export const HANDOVER_STATUSES = ['未移交', '已移交', '已入库'] as const
export type HandoverStatus = (typeof HANDOVER_STATUSES)[number]

/** 登账号核验状态：出土深度掉出所属地层单位区间时退回待核 */
export const ACCESSION_STATUSES = ['待核', '已确认'] as const
export type AccessionStatus = (typeof ACCESSION_STATUSES)[number]

/** Artifact 出土物 */
export interface Artifact {
  id: string
  // —— 以下由工地记录员维护（库房保管员不写） ——
  /** 所属地层单位（登记时锁定） */
  stratumId: string
  /** 器物编号（实物标签上的编号，不被库房登账号顶掉） */
  code: string
  category: ArtifactCategory
  /** 件数 */
  count: number
  completeness: Completeness
  /** 探方内坐标 X（米） */
  x: number
  /** 探方内坐标 Y（米） */
  y: number
  /** 探方内坐标 Z（距地表深度，米） */
  z: number
  date: string
  /** 提取人 */
  collector: string
  /** 临时存放位置 */
  tempLocation: string
  // —— 以下由库房保管员维护（工地记录员不写） ——
  /** 移交状态 */
  handover: HandoverStatus
  /** 移交日期 */
  handoverDate: string
  /** 登账号（库房登记号，与器物编号各自独立、互不覆盖） */
  accessionNo: string
  /** 登账号核验状态 */
  accessionStatus: AccessionStatus
  /** 库位 */
  storageLocation: string
  /** 借出去向（空串表示在库未借出） */
  loanTo: string
  /** 借出日期 */
  loanDate: string
  /** 入库日期 */
  checkinDate: string
  /** 最近一次入库失败原因（空串表示无失败记录） */
  checkinError: string
}

/** 工地记录员可写字段：器物编号、出土坐标等工地侧信息 */
export type SitePatch = Pick<
  Artifact,
  'id' | 'stratumId' | 'code' | 'category' | 'count' | 'completeness' | 'x' | 'y' | 'z' | 'date' | 'collector' | 'tempLocation'
>

/** 库房保管员可写字段：登账号、库位与借出，不含器物编号与出土坐标 */
export type WarehousePatch = Pick<Artifact, 'accessionNo' | 'storageLocation' | 'loanTo' | 'loanDate'>

/** 库房侧字段默认值：新登记出土物与旧数据升级都先归「未移交」 */
export function emptyWarehouseSide(): Pick<
  Artifact,
  'handover' | 'handoverDate' | 'accessionNo' | 'accessionStatus' | 'storageLocation' | 'loanTo' | 'loanDate' | 'checkinDate' | 'checkinError'
> {
  return {
    handover: '未移交',
    handoverDate: '',
    accessionNo: '',
    accessionStatus: '待核',
    storageLocation: '',
    loanTo: '',
    loanDate: '',
    checkinDate: '',
    checkinError: ''
  }
}

/** 出土深度是否掉出所属地层单位的深度区间 */
export function isDepthOutOfStratum(z: number, stratum: Pick<Stratum, 'topDepth' | 'bottomDepth'>): boolean {
  return z < stratum.topDepth || z > stratum.bottomDepth
}
