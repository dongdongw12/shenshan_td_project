window.MountainTD = window.MountainTD || {};

window.MountainTD.Renderer = (function () {
  const INK = "#221a15";

  function strokeFill(ctx, fillStyle, lineWidth) {
    if (fillStyle) {
      ctx.fillStyle = fillStyle;
      ctx.fill();
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = lineWidth || 2.4;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  }

  function drawRoundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawTerrain(ctx, W, H, time) {
    // 宣纸草地底色
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, "#769978");
    bgGrad.addColorStop(0.22, "#97b47c");
    bgGrad.addColorStop(1, "#85a66e");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // 远山青绿重彩（明清木刻粗墨线）
    ctx.beginPath();
    ctx.moveTo(0, 118);
    ctx.quadraticCurveTo(60, 42, 138, 86);
    ctx.quadraticCurveTo(215, 22, 295, 84);
    ctx.quadraticCurveTo(370, 38, W, 110);
    ctx.lineTo(W, 0);
    ctx.lineTo(0, 0);
    ctx.closePath();
    strokeFill(ctx, "#3d6e5d", 2.6);

    // 近山叠翠 + 山口出怪裂谷
    ctx.beginPath();
    ctx.moveTo(0, 148);
    ctx.quadraticCurveTo(78, 84, 158, 128);
    ctx.lineTo(176, 98);
    ctx.lineTo(254, 98);
    ctx.lineTo(272, 128);
    ctx.quadraticCurveTo(355, 82, W, 144);
    ctx.lineTo(W, 108);
    ctx.lineTo(0, 108);
    ctx.closePath();
    strokeFill(ctx, "#2c5749", 2.6);

    // 山口暗洞
    ctx.beginPath();
    ctx.ellipse(215, 102, 42, 18, 0, 0, Math.PI * 2);
    strokeFill(ctx, "#1b2824", 2.6);

    // 赭石山道（从山口直通篱笆和农舍）
    ctx.beginPath();
    ctx.moveTo(190, 106);
    ctx.quadraticCurveTo(182, 200, 174, 295);
    ctx.lineTo(178, 430);
    ctx.lineTo(252, 430);
    ctx.lineTo(256, 295);
    ctx.quadraticCurveTo(248, 200, 240, 106);
    ctx.closePath();
    strokeFill(ctx, "#d8bc8a", 2.4);

    // 左侧山谷溪流（捕鱼区）
    ctx.beginPath();
    ctx.moveTo(0, 355);
    ctx.quadraticCurveTo(85, 390, 96, 480);
    ctx.quadraticCurveTo(104, 575, 52, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    strokeFill(ctx, "#5b9db7", 2.6);

    // 溪流动态水波纹
    ctx.strokeStyle = "#e8f5f8";
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const wy = 395 + ((i * 44 + time * 18) % 240);
      const wx = 32 + Math.sin(wy * 0.03) * 20;
      ctx.beginPath();
      ctx.moveTo(wx, wy);
      ctx.quadraticCurveTo(wx + 12, wy - 4, wx + 24, wy);
      ctx.stroke();
    }

    // 右侧深山古松林（打猎/砍柴区）
    const pines = [
      { x: 378, y: 185, s: 1.0 },
      { x: 404, y: 235, s: 0.9 },
      { x: 392, y: 345, s: 1.05 },
      { x: 356, y: 382, s: 0.85 },
      { x: 395, y: 565, s: 1.0 },
      { x: 348, y: 595, s: 0.9 },
      { x: 36, y: 196, s: 0.95 },
      { x: 52, y: 265, s: 0.85 },
    ];
    pines.forEach((p) => drawPine(ctx, p.x, p.y, p.s));
  }

  function drawPine(ctx, x, y, scale) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    // 树干
    ctx.beginPath();
    ctx.rect(-4, 0, 8, 18);
    strokeFill(ctx, "#6b472d", 2.2);
    // 三层饱满松冠
    const layers = [
      { y: -4, w: 22, h: 16 },
      { y: -15, w: 18, h: 15 },
      { y: -25, w: 13, h: 13 },
    ];
    layers.forEach((l) => {
      ctx.beginPath();
      ctx.moveTo(0, l.y - l.h);
      ctx.lineTo(l.w, l.y + 4);
      ctx.quadraticCurveTo(0, l.y + 8, -l.w, l.y + 4);
      ctx.closePath();
      strokeFill(ctx, "#2e644c", 2.3);
    });
    ctx.restore();
  }

  function drawFence(ctx, state) {
    const f = window.MountainTD.CONFIG.FENCE;
    const left = f.x - f.width / 2;
    const y = f.y;

    if (state.fence.level === 0) {
      // 未建造：虚线提示框
      ctx.save();
      ctx.setLineDash([6, 5]);
      drawRoundedRect(ctx, left, y - 14, f.width, 28, 8);
      ctx.fillStyle = "rgba(246, 239, 226, 0.55)";
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = INK;
      ctx.font = "bold 12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("点击扎木篱笆防线（30木）", f.x, y + 4);
      return;
    }

    const isLv2 = state.fence.level >= 2;
    const hpRatio = Math.max(0, state.fence.hp / state.fence.maxHp);

    // 墙体主干
    if (isLv2) {
      drawRoundedRect(ctx, left, y - 15, f.width, 28, 5);
      strokeFill(ctx, "#8c7d6b", 2.6);
      // 砖缝
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.6;
      for (let bx = left + 22; bx < left + f.width; bx += 24) {
        ctx.beginPath();
        ctx.moveTo(bx, y - 14);
        ctx.lineTo(bx, y + 12);
        ctx.stroke();
      }
    } else {
      // 尖木桩篱笆
      for (let px = left + 6; px < left + f.width - 4; px += 14) {
        ctx.beginPath();
        ctx.moveTo(px, y + 12);
        ctx.lineTo(px, y - 8);
        ctx.lineTo(px + 5, y - 16);
        ctx.lineTo(px + 10, y - 8);
        ctx.lineTo(px + 10, y + 12);
        ctx.closePath();
        strokeFill(ctx, "#9e6b3f", 2.2);
      }
      ctx.beginPath();
      ctx.rect(left, y - 3, f.width, 7);
      strokeFill(ctx, "#7a4e2b", 2.2);
    }

    // 血条
    drawHpBar(ctx, f.x, y - 24, 96, 7, hpRatio, isLv2 ? "#46a678" : "#d98d36");
  }

  function drawHouse(ctx, state, time) {
    const h = window.MountainTD.CONFIG.HOUSE;
    const x = h.x;
    const y = h.y;
    const married = state.married;

    ctx.save();
    ctx.translate(x, y);

    // 院落底座
    ctx.beginPath();
    ctx.ellipse(0, 20, 62, 22, 0, 0, Math.PI * 2);
    strokeFill(ctx, "#ccb284", 2.2);

    // 墙体
    drawRoundedRect(ctx, -44, -20, 88, 42, 4);
    strokeFill(ctx, married ? "#f3ead8" : "#d9c29c", 2.6);

    // 朱红门柱（娶妻后更明艳）
    ctx.beginPath();
    ctx.rect(-12, -4, 24, 26);
    strokeFill(ctx, married ? "#b83b28" : "#7c5234", 2.4);

    // 窗格（夜晚泛暖黄灯火）
    const winColor = state.nightBlend > 0.2 ? "#ffcf66" : "#6c523c";
    ctx.beginPath();
    ctx.rect(-34, -6, 15, 15);
    ctx.rect(19, -6, 15, 15);
    strokeFill(ctx, winColor, 2.2);

    // 屋顶：茅草顶 vs 青瓦飞檐正房
    ctx.beginPath();
    ctx.moveTo(-58, -16);
    ctx.quadraticCurveTo(-24, -46, 0, -52);
    ctx.quadraticCurveTo(24, -46, 58, -16);
    ctx.lineTo(48, -10);
    ctx.lineTo(-48, -10);
    ctx.closePath();
    strokeFill(ctx, married ? "#2e5e56" : "#c79a4b", 2.8);

    // 屋脊与喜字灯笼
    if (married) {
      ctx.beginPath();
      ctx.moveTo(-26, -46);
      ctx.lineTo(26, -46);
      ctx.strokeStyle = "#b83b28";
      ctx.lineWidth = 4;
      ctx.stroke();

      // 门前红喜字
      drawRoundedRect(ctx, -7, -14, 14, 14, 2);
      strokeFill(ctx, "#c93322", 1.8);
      ctx.fillStyle = "#ffe58a";
      ctx.font = "bold 9px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("喜", 0, -4);

      // 两侧摇曳红灯笼
      const sway = Math.sin(time * 3.2) * 2.5;
      [-48, 48].forEach((lx) => {
        ctx.beginPath();
        ctx.moveTo(lx, -13);
        ctx.lineTo(lx + sway, -2);
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.8;
        ctx.stroke();

        ctx.beginPath();
        ctx.ellipse(lx + sway, 4, 7, 9, 0, 0, Math.PI * 2);
        strokeFill(ctx, "#d93626", 2.0);
      });
    }

    // 农舍血条
    const ratio = Math.max(0, state.houseHp / state.houseMaxHp);
    drawHpBar(ctx, 0, -64, 86, 7, ratio, "#3aa66d");
    ctx.fillStyle = INK;
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(married ? "青瓦正房（已成家）" : "漏风草棚", 0, 36);

    ctx.restore();
  }

  function drawSlots(ctx, state, time) {
    window.MountainTD.CONFIG.SLOTS.forEach((slot) => {
      const b = state.buildings[slot.id];
      const isSelected = state.selectedSlotId === slot.id;
      ctx.save();
      ctx.translate(slot.x, slot.y);

      if (!b) {
        // 空地圆桩标志
        ctx.beginPath();
        ctx.arc(0, 0, slot.r, 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? "rgba(255, 224, 140, 0.85)" : "rgba(246, 239, 226, 0.65)";
        ctx.fill();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = isSelected ? "#b83b28" : INK;
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.stroke();
        ctx.setLineDash([]);

        const iconMap = { tower: "🏹", trap: "⚙️", field: "🌾", fish: "🐟", hunt: "🦌" };
        ctx.font = "16px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(iconMap[slot.kind] || "+", 0, -4);

        ctx.fillStyle = INK;
        ctx.font = "bold 10px sans-serif";
        ctx.fillText(slot.kind === "tower" ? "箭楼位" : slot.kind === "trap" ? "陷阱位" : slot.kind === "field" ? "荒田" : slot.kind === "fish" ? "鱼梁位" : "猎棚位", 0, 14);
      } else {
        drawBuiltObject(ctx, slot, b, state, time, isSelected);
      }
      ctx.restore();
    });
  }

  function drawBuiltObject(ctx, slot, b, state, time, isSelected) {
    if (isSelected) {
      ctx.beginPath();
      ctx.arc(0, 0, slot.r + 6, 0, Math.PI * 2);
      ctx.strokeStyle = "#d93626";
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    if (b.kind === "tower") {
      // 射程淡淡提示（选中时）
      if (isSelected) {
        const spec = b.level === 2 ? window.MountainTD.CONFIG.BUILDINGS.tower.lv2 : window.MountainTD.CONFIG.BUILDINGS.tower.lv1;
        ctx.beginPath();
        ctx.arc(0, 0, spec.range, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 236, 179, 0.14)";
        ctx.fill();
        ctx.strokeStyle = "rgba(184, 59, 40, 0.45)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      // 塔身
      ctx.beginPath();
      ctx.moveTo(-16, 18);
      ctx.lineTo(-11, -16);
      ctx.lineTo(11, -16);
      ctx.lineTo(16, 18);
      ctx.closePath();
      strokeFill(ctx, b.level === 2 ? "#7a583b" : "#b88a50", 2.5);
      // 塔顶飞檐
      ctx.beginPath();
      ctx.moveTo(-24, -14);
      ctx.lineTo(0, -34);
      ctx.lineTo(24, -14);
      ctx.closePath();
      strokeFill(ctx, b.level === 2 ? "#b83b28" : "#3a6e58", 2.5);
      // 强弩标识
      ctx.fillStyle = "#fff7e0";
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(b.level === 2 ? "强弩" : "箭楼", 0, 5);
    } else if (b.kind === "trap") {
      ctx.beginPath();
      ctx.arc(0, 0, 17, 0, Math.PI * 2);
      strokeFill(ctx, b.charges > 0 ? "#665c55" : "#9c948d", 2.4);
      ctx.fillStyle = "#ffe599";
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(b.charges > 0 ? `夹×${b.charges}` : "已坏", 0, 4);
    } else if (b.kind === "field") {
      drawRoundedRect(ctx, -26, -18, 52, 36, 6);
      strokeFill(ctx, "#8c6239", 2.4);
      const pct = Math.min(1, b.progress / window.MountainTD.CONFIG.BUILDINGS.field.growTime);
      const stalkColor = b.ready ? "#f2c144" : "#6ca84f";
      for (let gx = -16; gx <= 16; gx += 8) {
        ctx.beginPath();
        ctx.moveTo(gx, 10);
        ctx.lineTo(gx + Math.sin(time * 3 + gx) * 2, 10 - 18 * pct);
        ctx.strokeStyle = stalkColor;
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      if (b.ready) drawReadyBadge(ctx, "收稻");
    } else if (b.kind === "fish") {
      drawRoundedRect(ctx, -22, -16, 44, 32, 8);
      strokeFill(ctx, "#c29258", 2.4);
      ctx.fillStyle = "#1c4a5e";
      ctx.font = "16px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("🐟", 0, 6);
      if (b.ready) drawReadyBadge(ctx, "收鱼");
    } else if (b.kind === "hunt") {
      ctx.beginPath();
      ctx.moveTo(-22, 16);
      ctx.lineTo(0, -20);
      ctx.lineTo(22, 16);
      ctx.closePath();
      strokeFill(ctx, "#8f5b34", 2.5);
      ctx.fillStyle = "#f6efe2";
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("🏹", 0, 10);
      if (b.ready) drawReadyBadge(ctx, "收猎");
    }
  }

  function drawReadyBadge(ctx, text) {
    drawRoundedRect(ctx, -22, -34, 44, 18, 9);
    strokeFill(ctx, "#ffe169", 2);
    ctx.fillStyle = INK;
    ctx.font = "bold 10px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(text, 0, -22);
  }

  function drawFarmerAndWife(ctx, state, time) {
    // 主角农夫
    const f = state.farmer;
    ctx.save();
    ctx.translate(f.x, f.y);
    const bob = Math.sin(time * 9) * (f.moving ? 2.5 : 0.6);

    // 脚底影
    ctx.beginPath();
    ctx.ellipse(0, 12, 11, 5, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.fill();

    // 粗布衣身
    drawRoundedRect(ctx, -9, -6 + bob, 18, 18, 5);
    strokeFill(ctx, "#3d5a73", 2.3);
    // 头
    ctx.beginPath();
    ctx.arc(0, -12 + bob, 7.5, 0, Math.PI * 2);
    strokeFill(ctx, "#f2cba5", 2.2);
    // 饱满草帽斗笠
    ctx.beginPath();
    ctx.moveTo(-16, -15 + bob);
    ctx.lineTo(0, -25 + bob);
    ctx.lineTo(16, -15 + bob);
    ctx.closePath();
    strokeFill(ctx, "#d9a94e", 2.3);

    // 手持柴刀/火把
    ctx.beginPath();
    ctx.moveTo(10, 0 + bob);
    ctx.lineTo(18, -8 + bob + (f.swingTimer > 0 ? 10 : 0));
    ctx.strokeStyle = state.phase === "NIGHT" ? "#ff9933" : "#5c4028";
    ctx.lineWidth = 3.5;
    ctx.stroke();

    ctx.restore();

    // 发妻“阿莲”（娶妻后登场）
    if (state.married) {
      const w = state.wife;
      ctx.save();
      ctx.translate(w.x, w.y);
      const wbob = Math.sin(time * 7 + 1) * 1.6;
      ctx.beginPath();
      ctx.ellipse(0, 11, 10, 4.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.2)";
      ctx.fill();

      // 朱红襦裙
      ctx.beginPath();
      ctx.moveTo(-10, 12 + wbob);
      ctx.lineTo(-7, -6 + wbob);
      ctx.lineTo(7, -6 + wbob);
      ctx.lineTo(10, 12 + wbob);
      ctx.closePath();
      strokeFill(ctx, "#c94638", 2.2);
      // 头与发髻
      ctx.beginPath();
      ctx.arc(0, -12 + wbob, 7, 0, Math.PI * 2);
      strokeFill(ctx, "#f7d4b2", 2.2);
      ctx.beginPath();
      ctx.arc(0, -18 + wbob, 4.5, 0, Math.PI * 2);
      strokeFill(ctx, "#221a15", 1.8);

      ctx.fillStyle = INK;
      ctx.font = "bold 10px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("阿莲", 0, 24);
      ctx.restore();
    }
  }

  function drawEnemies(ctx, state, time) {
    state.enemies.forEach((e) => {
      ctx.save();
      ctx.translate(e.x, e.y);
      const wobble = Math.sin(time * 10 + e.id) * 2;
      const fill = e.flashTimer > 0 ? "#ffffff" : e.color;

      // 影子
      ctx.beginPath();
      ctx.ellipse(0, e.radius * 0.75, e.radius * 0.9, e.radius * 0.4, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fill();

      if (e.type === "bear") {
        // 黑熊王
        ctx.beginPath();
        ctx.arc(0, wobble, e.radius, 0, Math.PI * 2);
        strokeFill(ctx, fill, 3);
        ctx.beginPath();
        ctx.arc(-15, -18 + wobble, 7, 0, Math.PI * 2);
        ctx.arc(15, -18 + wobble, 7, 0, Math.PI * 2);
        strokeFill(ctx, fill, 2.5);
        // 凶眼
        ctx.fillStyle = "#ff5c33";
        ctx.fillRect(-8, -4 + wobble, 5, 4);
        ctx.fillRect(3, -4 + wobble, 5, 4);
      } else if (e.type === "boar") {
        ctx.beginPath();
        ctx.ellipse(0, wobble, e.radius, e.radius * 0.78, 0, 0, Math.PI * 2);
        strokeFill(ctx, fill, 2.5);
        // 獠牙
        ctx.beginPath();
        ctx.moveTo(-7, 6 + wobble);
        ctx.lineTo(-12, 13 + wobble);
        ctx.moveTo(7, 6 + wobble);
        ctx.lineTo(12, 13 + wobble);
        ctx.strokeStyle = "#fff8e7";
        ctx.lineWidth = 3;
        ctx.stroke();
      } else {
        // 饿狼
        ctx.beginPath();
        ctx.ellipse(0, wobble, e.radius, e.radius * 0.85, 0, 0, Math.PI * 2);
        strokeFill(ctx, fill, 2.3);
        ctx.beginPath();
        ctx.moveTo(-9, -7 + wobble);
        ctx.lineTo(-11, -16 + wobble);
        ctx.lineTo(-3, -10 + wobble);
        ctx.moveTo(9, -7 + wobble);
        ctx.lineTo(11, -16 + wobble);
        ctx.lineTo(3, -10 + wobble);
        strokeFill(ctx, fill, 2.0);
        ctx.fillStyle = "#ffd15c";
        ctx.fillRect(-5, -2 + wobble, 3, 3);
        ctx.fillRect(2, -2 + wobble, 3, 3);
      }

      if (e.slowTimer > 0) {
        ctx.strokeStyle = "#6bd4ff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, e.radius + 4, 0, Math.PI * 2);
        ctx.stroke();
      }

      drawHpBar(ctx, 0, -e.radius - 10, e.isBoss ? 56 : 30, 5, Math.max(0, e.hp / e.maxHp), e.isBoss ? "#e03e2d" : "#e86a42");
      ctx.restore();
    });
  }

  function drawProjectilesAndFx(ctx, state) {
    // 箭矢
    state.projectiles.forEach((p) => {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.atan2(p.vy, p.vx));
      ctx.beginPath();
      ctx.moveTo(-9, 0);
      ctx.lineTo(9, 0);
      ctx.strokeStyle = p.lv2 ? "#ff9f2e" : "#221a15";
      ctx.lineWidth = p.lv2 ? 3.2 : 2.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(9, 0);
      ctx.lineTo(4, -3.5);
      ctx.lineTo(4, 3.5);
      ctx.closePath();
      ctx.fillStyle = p.lv2 ? "#ffe066" : "#b83b28";
      ctx.fill();
      ctx.restore();
    });

    // 飘字与粒子
    state.particles.forEach((pt) => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    state.floatTexts.forEach((ft) => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, ft.life / ft.maxLife);
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "center";
      ctx.lineWidth = 3;
      ctx.strokeStyle = INK;
      ctx.strokeText(ft.text, ft.x, ft.y);
      ctx.fillStyle = ft.color || "#ffe885";
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    });
  }

  function drawNightLighting(ctx, W, H, state) {
    if (state.nightBlend <= 0.02) return;
    ctx.save();
    // 深靛蓝夜幕
    ctx.fillStyle = `rgba(14, 22, 50, ${(state.nightBlend * 0.56).toFixed(3)})`;
    ctx.fillRect(0, 0, W, H);

    // 暖橙灯火光晕（农舍、箭楼、主角火把）
    ctx.globalCompositeOperation = "lighter";
    const lights = [
      { x: window.MountainTD.CONFIG.HOUSE.x, y: window.MountainTD.CONFIG.HOUSE.y, r: state.married ? 128 : 85, a: 0.28 },
      { x: state.farmer.x, y: state.farmer.y, r: 68, a: 0.22 },
    ];
    Object.keys(state.buildings).forEach((id) => {
      const b = state.buildings[id];
      if (b.kind === "tower") {
        const s = window.MountainTD.CONFIG.SLOTS.find((it) => it.id === id);
        if (s) lights.push({ x: s.x, y: s.y - 12, r: 78, a: 0.22 });
      }
    });
    lights.forEach((l) => {
      const g = ctx.createRadialGradient(l.x, l.y, 4, l.x, l.y, l.r);
      g.addColorStop(0, `rgba(255, 194, 88, ${(l.a * state.nightBlend).toFixed(3)})`);
      g.addColorStop(1, "rgba(255, 160, 50, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(l.x, l.y, l.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  function drawBubble(ctx, state) {
    if (!state.bubble || state.bubble.timer <= 0) return;
    const text = state.bubble.text;
    ctx.save();
    ctx.font = "bold 12px sans-serif";
    const tw = Math.min(260, ctx.measureText(text).width + 24);
    const bx = Math.max(12, Math.min(430 - tw - 12, state.bubble.x - tw / 2));
    const by = Math.max(46, state.bubble.y - 46);
    drawRoundedRect(ctx, bx, by, tw, 28, 10);
    strokeFill(ctx, "#fff8e8", 2.2);
    ctx.fillStyle = INK;
    ctx.textAlign = "center";
    ctx.fillText(text, bx + tw / 2, by + 18);
    ctx.restore();
  }

  function drawHpBar(ctx, cx, y, w, h, ratio, color) {
    ctx.fillStyle = "#2b211b";
    ctx.fillRect(cx - w / 2 - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = "#5c4a3e";
    ctx.fillRect(cx - w / 2, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(cx - w / 2, y, w * Math.max(0, Math.min(1, ratio)), h);
  }

  return {
    render(ctx, state, time) {
      const W = window.MountainTD.CONFIG.WIDTH;
      const H = window.MountainTD.CONFIG.HEIGHT;
      ctx.save();
      if (state.shakeTimer > 0) {
        const mag = state.shakeTimer * 14;
        ctx.translate((Math.random() - 0.5) * mag, (Math.random() - 0.5) * mag);
      }
      drawTerrain(ctx, W, H, time);
      drawFence(ctx, state);
      drawSlots(ctx, state, time);
      drawHouse(ctx, state, time);
      drawEnemies(ctx, state, time);
      drawFarmerAndWife(ctx, state, time);
      drawProjectilesAndFx(ctx, state);
      drawNightLighting(ctx, W, H, state);
      drawBubble(ctx, state);
      ctx.restore();
    },
  };
})();
