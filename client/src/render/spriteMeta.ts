/**
 * 烘培精灵元数据（stylize_sprites.py 输出的 <stem>_meta.json，经 export_sprites.py 缩放后汇总到 sprites.json）。
 * 约定：
 *   - 同一资产的 day / night / shadow 三张图尺寸、锚点完全一致；
 *   - anchor_px = 占地中心落地点在图中的像素位置（自上而下）；
 *   - 全部精灵 px_per_meter 相同（母版 128，导出缩放后同比变化），客户端不需要逐张缩放。
 */

export interface SpriteMeta {
  id: string;
  name?: string;
  angle?: number;
  /** [宽, 高] 像素 */
  resolution: [number, number];
  anchor_px: [number, number];
  px_per_meter: number;
  tile_size_m: number;
  camera_elevation_deg: number;
  /** "AxB"：沿世界 X 占 A 格、沿 Y 占 B 格 */
  footprint: string;
  day_file: string;
  night_file: string;
  shadow_file?: string;
  /** 夜晚地影透明度倍率（默认 0.6） */
  night_shadow_opacity?: number;
  actual_height_m?: number;
  /** 一格地块菱形的屏幕宽高（像素，母版比例） */
  tile_px?: [number, number];
}

export interface SpriteAtlasIndex {
  /** 导出缩放（相对母版） */
  scale: number;
  px_per_meter: number;
  sprites: Record<string, SpriteMeta>;
}

export function parseFootprint(fp: string | undefined): { w: number; d: number } {
  const m = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/i.exec((fp ?? "1x1").trim());
  if (!m) return { w: 1, d: 1 };
  return { w: Number(m[1]), d: Number(m[2]) };
}

/** 校验一批精灵是否同一比例与镜头（混用会让墨线粗细、比例在地图上不一致） */
export function validateAtlas(index: SpriteAtlasIndex): string[] {
  const problems: string[] = [];
  for (const [stem, m] of Object.entries(index.sprites)) {
    if (Math.abs(m.px_per_meter - index.px_per_meter) > 1e-3) {
      problems.push(`${stem}: px_per_meter ${m.px_per_meter} ≠ ${index.px_per_meter}`);
    }
    if (Math.abs(m.camera_elevation_deg - 30) > 1e-3) {
      problems.push(`${stem}: camera_elevation_deg ${m.camera_elevation_deg} ≠ 30（不是 2:1 等距）`);
    }
    const [w, h] = m.resolution;
    const [ax, ay] = m.anchor_px;
    if (!(ax >= 0 && ax <= w && ay >= 0 && ay <= h)) {
      problems.push(`${stem}: anchor_px (${ax}, ${ay}) 不在图内 ${w}×${h}`);
    }
  }
  return problems;
}
