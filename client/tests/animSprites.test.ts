import { describe, expect, it } from "vitest";
import { facingFromScreenDelta } from "../src/render/animSprites";

describe("角色朝向", () => {
  const prev = { dir: "front" as const, flip: false };
  it("屏幕上往下走 = 面朝相机（front），往右走 = 镜像", () => {
    expect(facingFromScreenDelta(-1, 1, prev)).toEqual({ dir: "front", flip: false }); // 左下
    expect(facingFromScreenDelta(1, 1, prev)).toEqual({ dir: "front", flip: true });   // 右下
    expect(facingFromScreenDelta(-1, -1, prev)).toEqual({ dir: "back", flip: false }); // 左上
    expect(facingFromScreenDelta(1, -1, prev)).toEqual({ dir: "back", flip: true });   // 右上
  });
  it("站着不动保持上一帧朝向", () => {
    const p = { dir: "back" as const, flip: true };
    expect(facingFromScreenDelta(0, 0, p)).toBe(p);
  });
});
