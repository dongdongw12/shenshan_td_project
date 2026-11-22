/**
 * 场景：地块网格 + 建筑精灵 + 自绘物体（单位、投射物、特效）。
 * 只存数据，不依赖画布；渲染交给 renderer.ts，排序交给 depthSort.ts。
 */
import { footprintRect, pointRect, type Footprint, type Sortable } from "./depthSort";
import { staggerDelay } from "./dayNight";
import { parseFootprint, type SpriteAtlasIndex } from "./spriteMeta";
import type { Vec2, Vec3 } from "./iso";

export interface SpriteObject {
  kind: "sprite";
  id: string;
  /** sprites.json 里的 stem（如 house_lv2_tile、fence_wood_a90） */
  stem: string;
  /** 占地左下角所在格 */
  i: number;
  j: number;
  /** 点灯延迟 0…0.45（默认按 id 哈希） */
  lightDelay: number;
}

export interface CustomObject {
  kind: "custom";
  id: string;
  /** 世界坐标（米） */
  pos: Vec3;
  /** 占地半径（米），用于遮挡排序；0 = 点 */
  radius: number;
  bias?: number;
  draw(ctx: CanvasRenderingContext2D, screen: Vec2, pxPerMeter: number, nightAlpha: number): void;
}

export type SceneObject = SpriteObject | CustomObject;

export class Scene {
  readonly objects: SceneObject[] = [];

  constructor(
    readonly cols: number,
    readonly rows: number,
    readonly atlas: SpriteAtlasIndex,
    readonly tileSize = 2,
  ) {}

  addSprite(stem: string, i: number, j: number, id = `${stem}@${i},${j}`): SpriteObject {
    if (!this.atlas.sprites[stem]) throw new Error(`sprites.json 里没有 ${stem}`);
    const o: SpriteObject = { kind: "sprite", id, stem, i, j, lightDelay: staggerDelay(id) };
    this.objects.push(o);
    return o;
  }

  addCustom(o: Omit<CustomObject, "kind">): CustomObject {
    const c: CustomObject = { kind: "custom", ...o };
    this.objects.push(c);
    return c;
  }

  remove(id: string): void {
    const k = this.objects.findIndex((o) => o.id === id);
    if (k >= 0) this.objects.splice(k, 1);
  }

  footprintOf(o: SceneObject): Footprint {
    if (o.kind === "custom") {
      const r = o.radius;
      return r > 0 ? { x0: o.pos.x - r, x1: o.pos.x + r, y0: o.pos.y - r, y1: o.pos.y + r } : pointRect(o.pos.x, o.pos.y);
    }
    const fp = parseFootprint(this.atlas.sprites[o.stem]!.footprint);
    return footprintRect(o.i, o.j, fp.w, fp.d, this.tileSize);
  }

  /** 精灵锚点（占地中心，地面）的世界坐标 */
  anchorWorld(o: SpriteObject): Vec2 {
    const fp = parseFootprint(this.atlas.sprites[o.stem]!.footprint);
    return { x: (o.i + fp.w / 2) * this.tileSize, y: (o.j + fp.d / 2) * this.tileSize };
  }

  sortables(): (Sortable & { obj: SceneObject })[] {
    return this.objects.map((obj) => ({
      ...this.footprintOf(obj),
      key: obj.id,
      bias: obj.kind === "custom" ? obj.bias ?? 0 : 0,
      obj,
    }));
  }
}
