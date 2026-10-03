/** 器物类别 */
export const ARTIFACT_CATEGORIES = ['陶器', '瓷器', '石器', '骨器', '铜器'] as const
export type ArtifactCategory = (typeof ARTIFACT_CATEGORIES)[number]

/** 残整程度 */
export const COMPLETENESS = ['完整', '可复原', '残片'] as const
export type Completeness = (typeof COMPLETENESS)[number]

/**
 * 库房入库状态
 * - 未移交：出土后放在工地临时柜，尚未回驻地入库（旧数据升级后也归此态）
 * - 待核：出土深度掉出所属地层单位区间，登账号退回，待核对层位后由库房侧重试
 * - 已入库：登账号与库位已由库房保管员分配
 */
export const WAREHOUSE_STATUSES = ['未移交', '待核', '已入库'] as const
export type WarehouseStatus = (typeof WAREHOUSE_STATUSES)[number]

/** Artifact 出土物 */
export interface Artifact {
  id: string
  /** 所属地层单位（登记时锁定） */
  stratumId: string
  /** 器物编号（记录员管理，实物标签上的编号，不随库房登账号变更） */
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
  /** 临时存放位置（工地临时柜，记录员管理；库房字段不受其影响） */
  tempLocation: string
  /** 登账号（库房保管员分配；深度待核期间退回，不顶掉器物编号） */
  accessionNo?: string
  /** 库位（库房保管员排定，不覆盖出土坐标） */
  warehouseLocation?: string
  /** 库位借出中（库房保管员管理） */
  onLoan?: boolean
  /** 库房入库状态；旧数据无入库信息，升级后归「未移交」 */
  warehouseStatus?: WarehouseStatus
}
