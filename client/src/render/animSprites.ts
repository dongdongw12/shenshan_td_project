/**
 * 角色序列帧（pipeline/blender/bake_sprite_anim.py 输出）。
 * 每个角色两个朝向的横排精灵表：front = 面朝屏幕左下，back = 面朝屏幕左上；朝右的两个方向水平镜像。
 */
import type { ImageLike } from "../platform/platform";
import type { Vec2 } from "./iso";

export interface AnimMeta {
  id: string;
  frames: number;
  fps: number;
  frame_size: [number, number];
  anchor_px: [number, number];
  px_per_meter: number;
  dirs: Record<"front" | "back", { day: string; night: string }>;
}

export interface AnimIndex {
  px_per_meter: number;
  chars: Record<string, AnimMeta>;
}

export interface AnimImages {
  front: { day: ImageLike; night: ImageLike };
  back: { day: ImageLike; night: ImageLike };
}

/** 由屏幕上的移动方向选朝向与是否镜像：下 = 朝相机（front），右 = 镜像 */
export function facingFromScreenDelta(dx: number, dy: number, prev: { dir: "front" | "back"; flip: boolean }): { dir: "front" | "back"; flip: boolean } {
  if (Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4) return prev;
  return { dir: dy >= 0 ? "front" : "back", flip: dx > 0 };
}

/** 画一帧：p = 脚底屏幕位置，pxPerMeter = 当前屏幕每米像素，night 0..1 时白昼/夜晚两张交叉淡入 */
export function drawAnimFrame(ctx: CanvasRenderingContext2D, meta: AnimMeta, img: AnimImages, p: Vec2, pxPerMeter: number,
  scale: number, dir: "front" | "back", flip: boolean, timeS: number, night: number): void {
  const [fw, fh] = meta.frame_size;
  const frame = Math.floor(timeS * meta.fps) % meta.frames;
  const k = (pxPerMeter / meta.px_per_meter) * scale;
  const [ax, ay] = meta.anchor_px;
  ctx.save();
  ctx.translate(p.x, p.y);
  if (flip) ctx.scale(-1, 1);
  const draw = (src: ImageLike, alpha: number) => {
    if (alpha <= 0.002) return;
    ctx.globalAlpha = alpha;
    ctx.drawImage(src, frame * fw, 0, fw, fh, -ax * k, -ay * k, fw * k, fh * k);
  };
  draw(img[dir].day, 1);
  draw(img[dir].night, night);
  ctx.restore();
  ctx.globalAlpha = 1;
}
