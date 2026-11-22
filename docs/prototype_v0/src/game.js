window.MountainTD = window.MountainTD || {};

(function () {
  const CFG = window.MountainTD.CONFIG;
  const Audio = window.MountainTD.Audio;
  const Renderer = window.MountainTD.Renderer;

  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d");

  // UI 引用
  const ui = {
    dayBadge: document.getElementById("day-badge"),
    phaseBadge: document.getElementById("phase-badge"),
    timerText: document.getElementById("timer-text"),
    coin: document.getElementById("res-coin"),
    wood: document.getElementById("res-wood"),
    food: document.getElementById("res-food"),
    hide: document.getElementById("res-hide"),
    goalText: document.getElementById("goal-text"),
    popover: document.getElementById("slot-popover"),
    popTitle: document.getElementById("pop-title"),
    popDesc: document.getElementById("pop-desc"),
    popActions: document.getElementById("pop-actions"),
    popClose: document.getElementById("pop-close"),
    overlay: document.getElementById("overlay"),
    ovSeal: document.getElementById("ov-seal"),
    ovTitle: document.getElementById("ov-title"),
    ovBody: document.getElementById("ov-body"),
    ovStats: document.getElementById("ov-stats"),
    ovButtons: document.getElementById("ov-buttons"),
    btnStart: document.getElementById("btn-start"),
    btnChop: document.getElementById("btn-chop"),
    btnMarry: document.getElementById("btn-marry"),
    marryLabel: document.getElementById("marry-label"),
    btnAd: document.getElementById("btn-ad"),
    btnNight: document.getElementById("btn-night"),
    nightLabel: document.getElementById("night-label"),
  };

  let state = null;
  let enemyUid = 1;
  let lastTs = 0;
  let clock = 0;

  function createInitialState() {
    return {
      phase: "TITLE", // TITLE | DAY | NIGHT | PAUSED | END
      day: 1,
      dayTimer: CFG.DAY_DURATION,
      nightBlend: 0,
      res: { ...CFG.INITIAL_RESOURCES },
      married: false,
      houseHp: CFG.HOUSE.baseMaxHp,
      houseMaxHp: CFG.HOUSE.baseMaxHp,
      fence: { level: 0, hp: 0, maxHp: 0 },
      buildings: {},
      selectedSlotId: null,
      farmer: {
        x: 215,
        y: 446,
        targetX: 215,
        targetY: 446,
        moving: false,
        attackCd: 0,
        swingTimer: 0,
      },
      wife: {
        x: 256,
        y: 432,
        harvestTimer: 2.5,
      },
      enemies: [],
      projectiles: [],
      particles: [],
      floatTexts: [],
      spawnQueue: [],
      spawnTimer: 0,
      bubble: null,
      quoteTimer: 4,
      shakeTimer: 0,
      adUsedToday: false,
      stats: { kills: 0, earnedCoin: 0, marriedDay: null },
    };
  }

  function hasCost(cost) {
    return (
      (!cost.coin || state.res.coin >= cost.coin) &&
      (!cost.wood || state.res.wood >= cost.wood) &&
      (!cost.food || state.res.food >= cost.food) &&
      (!cost.hide || state.res.hide >= cost.hide)
    );
  }

  function payCost(cost) {
    if (cost.coin) state.res.coin -= cost.coin;
    if (cost.wood) state.res.wood -= cost.wood;
    if (cost.food) state.res.food -= cost.food;
    if (cost.hide) state.res.hide -= cost.hide;
  }

  function formatCost(cost) {
    const parts = [];
    if (cost.coin) parts.push(`${cost.coin}铜钱`);
    if (cost.wood) parts.push(`${cost.wood}木`);
    if (cost.hide) parts.push(`${cost.hide}兽材`);
    return parts.join(" + ");
  }

  function addFloat(x, y, text, color) {
    state.floatTexts.push({ x, y, text, color: color || "#ffe885", life: 1.15, maxLife: 1.15 });
  }

  function spawnParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 30 + Math.random() * 80;
      state.particles.push({
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 20,
        r: 2.5 + Math.random() * 3,
        color,
        life: 0.45 + Math.random() * 0.35,
        maxLife: 0.8,
      });
    }
  }

  function showBubble(x, y, text, duration) {
    state.bubble = { x, y, text, timer: duration || 3.4 };
  }

  function updateHud() {
    ui.dayBadge.textContent = `第 ${state.day} / ${CFG.MAX_DAYS} 天`;
    if (state.phase === "NIGHT") {
      ui.phaseBadge.textContent = "黑夜 · 御敌";
      ui.phaseBadge.className = "phase-night";
      ui.timerText.textContent = `余 ${state.enemies.length + state.spawnQueue.length} 敌`;
    } else {
      ui.phaseBadge.textContent = "白昼 · 开荒";
      ui.phaseBadge.className = "phase-day";
      ui.timerText.textContent = `${Math.ceil(state.dayTimer)}s`;
    }

    ui.coin.textContent = Math.floor(state.res.coin);
    ui.wood.textContent = Math.floor(state.res.wood);
    ui.food.textContent = Math.floor(state.res.food);
    ui.hide.textContent = Math.floor(state.res.hide);

    const waveCfg = CFG.WAVES[Math.min(state.day - 1, CFG.WAVES.length - 1)];
    if (!state.married && state.res.coin >= CFG.HOUSE.marryCost.coin && state.res.wood >= CFG.HOUSE.marryCost.wood) {
      ui.goalText.textContent = "聘礼与木材已齐！点下方【修房娶妻】喜结良缘、解锁自动收成与回血！";
    } else {
      ui.goalText.textContent = state.phase === "NIGHT"
        ? `${waveCfg.title}：点击地面可指挥农夫跑动补刀！`
        : waveCfg.hint;
    }

    ui.btnChop.disabled = state.phase !== "DAY";
    ui.btnNight.disabled = state.phase !== "DAY";
    ui.nightLabel.textContent = state.phase === "NIGHT" ? "激战中..." : "提前入夜";

    if (state.married) {
      ui.marryLabel.textContent = "已成家 · 阿莲助阵";
      ui.btnMarry.disabled = true;
    } else {
      ui.marryLabel.textContent = `修房娶妻 ${CFG.HOUSE.marryCost.coin}钱`;
      ui.btnMarry.disabled = state.phase !== "DAY" || !hasCost(CFG.HOUSE.marryCost);
    }

    ui.btnAd.disabled = state.adUsedToday || (state.phase !== "DAY" && state.phase !== "NIGHT");
  }

  function closePopover() {
    state.selectedSlotId = null;
    ui.popover.classList.add("hidden");
  }

  function openFencePopover() {
    state.selectedSlotId = "fence";
    ui.popover.classList.remove("hidden");
    ui.popActions.innerHTML = "";

    if (state.fence.level === 0) {
      ui.popTitle.textContent = "山口防线（空）";
      ui.popDesc.textContent = "扎起尖木篱笆（260血），挡住饿狼与野猪直扑草棚。";
      addPopBtn(`扎木篱笆（${formatCost(CFG.FENCE.buildCost)}）`, !hasCost(CFG.FENCE.buildCost), () => {
        payCost(CFG.FENCE.buildCost);
        state.fence = { level: 1, hp: CFG.FENCE.lv1Hp, maxHp: CFG.FENCE.lv1Hp };
        Audio.build();
        spawnParticles(CFG.FENCE.x, CFG.FENCE.y, "#c9862c", 12);
        addFloat(CFG.FENCE.x, CFG.FENCE.y - 20, "木篱笆建成！", "#ffe58a");
        closePopover();
        updateHud();
      });
    } else {
      ui.popTitle.textContent = state.fence.level === 1 ? "木篱笆防线（1级）" : "加固青砖木墙（2级）";
      ui.popDesc.textContent = `当前耐久 ${Math.ceil(state.fence.hp)} / ${state.fence.maxHp}。`;
      if (state.fence.hp < state.fence.maxHp) {
        addPopBtn(`修补满血（${CFG.FENCE.repairCostCoin}铜钱）`, state.res.coin < CFG.FENCE.repairCostCoin, () => {
          state.res.coin -= CFG.FENCE.repairCostCoin;
          state.fence.hp = state.fence.maxHp;
          Audio.build();
          addFloat(CFG.FENCE.x, CFG.FENCE.y - 20, "防线已修复！", "#8df0a8");
          closePopover();
          updateHud();
        }, "secondary");
      }
      if (state.fence.level === 1) {
        addPopBtn(`升级加固墙（${formatCost(CFG.FENCE.upgradeCost)}）`, !hasCost(CFG.FENCE.upgradeCost), () => {
          payCost(CFG.FENCE.upgradeCost);
          state.fence = { level: 2, hp: CFG.FENCE.lv2Hp, maxHp: CFG.FENCE.lv2Hp };
          Audio.build();
          spawnParticles(CFG.FENCE.x, CFG.FENCE.y, "#ffe58a", 16);
          addFloat(CFG.FENCE.x, CFG.FENCE.y - 20, "加固防线（540血）！", "#ffe58a");
          closePopover();
          updateHud();
        });
      }
    }
  }

  function openSlotPopover(slot) {
    state.selectedSlotId = slot.id;
    const b = state.buildings[slot.id];
    const spec = CFG.BUILDINGS[slot.kind];
    ui.popover.classList.remove("hidden");
    ui.popActions.innerHTML = "";

    if (!b) {
      ui.popTitle.textContent = `${slot.name} · 建造${spec.name}`;
      ui.popDesc.textContent = spec.desc;
      addPopBtn(`建造（${formatCost(spec.buildCost)}）`, !hasCost(spec.buildCost), () => {
        payCost(spec.buildCost);
        state.buildings[slot.id] = {
          kind: slot.kind,
          level: 1,
          fireCd: 0,
          progress: 0,
          ready: false,
          charges: spec.charges || 0,
        };
        Audio.build();
        spawnParticles(slot.x, slot.y, "#ffe169", 10);
        addFloat(slot.x, slot.y - 20, `${spec.name}落成！`, "#ffe885");
        closePopover();
        updateHud();
      });
      return;
    }

    if (b.kind === "tower") {
      ui.popTitle.textContent = b.level === 2 ? `${spec.lv2Name}（满级）` : `${spec.name}（1级）`;
      ui.popDesc.textContent = b.level === 2
        ? "高伤远程强弩，守夜主力输出！"
        : "升级为强弩楼后伤害翻倍（38伤）且射程更远，专打野猪与黑熊。";
      if (b.level === 1) {
        addPopBtn(`升级强弩楼（${formatCost(spec.upgradeCost)}）`, !hasCost(spec.upgradeCost), () => {
          payCost(spec.upgradeCost);
          b.level = 2;
          Audio.build();
          spawnParticles(slot.x, slot.y, "#ff9f2e", 16);
          addFloat(slot.x, slot.y - 24, "强弩楼升级完成！", "#ffb84d");
          closePopover();
          updateHud();
        });
      }
    } else if (b.kind === "trap") {
      ui.popTitle.textContent = `${spec.name}（余 ${b.charges} 次）`;
      ui.popDesc.textContent = spec.desc;
      if (b.charges < spec.charges) {
        addPopBtn(`重置捕兽夹（25铜钱）`, state.res.coin < 25, () => {
          state.res.coin -= 25;
          b.charges = spec.charges;
          Audio.build();
          addFloat(slot.x, slot.y - 18, "捕兽夹已上弦！", "#8df0a8");
          closePopover();
          updateHud();
        }, "secondary");
      }
    } else {
      ui.popTitle.textContent = spec.name;
      ui.popDesc.textContent = b.ready ? "已成熟！点击即可立刻收获。" : "正在自动产出中，成熟后点击收获（娶妻后阿莲会自动帮你收）。";
      if (b.ready) {
        addPopBtn("立刻收获", false, () => {
          harvestBuilding(slot, b, false);
          closePopover();
        }, "secondary");
      }
    }
  }

  function addPopBtn(label, disabled, onClick, extraClass) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `pop-btn ${extraClass || ""}`;
    btn.textContent = label;
    btn.disabled = !!disabled;
    btn.addEventListener("click", onClick);
    ui.popActions.appendChild(btn);
  }

  function harvestBuilding(slot, b, byWife) {
    const spec = CFG.BUILDINGS[b.kind];
    const mult = state.married ? 1.4 : 1.0;
    const coinGain = Math.round((spec.yieldCoin || 0) * mult);
    const foodGain = Math.round((spec.yieldFood || 0) * mult);
    const hideGain = spec.yieldHide || 0;

    state.res.coin += coinGain;
    state.res.food += foodGain;
    state.res.hide += hideGain;
    state.stats.earnedCoin += coinGain;
    b.ready = false;
    b.progress = 0;

    Audio.coin();
    spawnParticles(slot.x, slot.y, "#ffe169", 8);
    const label = hideGain > 0 ? `+${coinGain}钱 +${hideGain}兽材` : `+${coinGain}钱 +${foodGain}粮`;
    addFloat(slot.x, slot.y - 20, byWife ? `阿莲收：${label}` : label, "#ffe885");
    updateHud();
  }

  function triggerMarry() {
    if (state.married || !hasCost(CFG.HOUSE.marryCost)) return;
    payCost(CFG.HOUSE.marryCost);
    state.married = true;
    state.houseMaxHp = CFG.HOUSE.marriedMaxHp;
    state.houseHp = state.houseMaxHp;
    state.stats.marriedDay = state.day;

    Audio.wedding();
    spawnParticles(CFG.HOUSE.x, CFG.HOUSE.y - 20, "#e63928", 32);
    spawnParticles(CFG.HOUSE.x, CFG.HOUSE.y - 20, "#ffd75e", 24);
    closePopover();
    updateHud();

    showOverlay({
      seal: "喜结良缘",
      title: "青瓦正房落成 · 迎娶发妻阿莲！",
      body: "十里山路红绸漫卷，你终于在深山有了真正的家。<br /><b>家族增益已激活：</b><br />1. 阿莲白天自动收稻、收鱼、收猎，收益 <b>+40%</b>；<br />2. 入夜后阿莲熬姜汤，每秒为防线与正房回复 <b>12 点血量</b>；<br />3. 正房耐久提升至 <b>560</b>，守住今夜离深山望族更近一步！",
      buttons: [{ label: "携手守家 · 继续开荒", primary: true, onClick: hideOverlay }],
    });
  }

  function startNight() {
    if (state.phase !== "DAY") return;
    closePopover();
    state.phase = "NIGHT";
    state.spawnQueue = [];
    const wave = CFG.WAVES[Math.min(state.day - 1, CFG.WAVES.length - 1)];
    wave.spawns.forEach((group) => {
      for (let i = 0; i < group.count; i++) {
        state.spawnQueue.push({ type: group.type, delay: group.interval });
      }
    });
    state.spawnTimer = 0.6;
    Audio.nightStart();
    showBubble(
      state.farmer.x,
      state.farmer.y,
      state.married ? "阿莲：入夜了，当家的守住山口！" : "天黑了！野兽要下山了！",
      3.5
    );
    updateHud();
  }

  function spawnEnemy(type) {
    const spec = CFG.ENEMIES[type];
    const startX = 195 + Math.random() * 40;
    state.enemies.push({
      id: enemyUid++,
      type,
      name: spec.name,
      x: startX,
      y: 108,
      hp: spec.hp,
      maxHp: spec.hp,
      speed: spec.speed,
      dmg: spec.dmg,
      attackCd: spec.attackCd,
      atkTimer: 0,
      rewardCoin: spec.rewardCoin,
      rewardHide: spec.rewardHide,
      radius: spec.radius,
      color: spec.color,
      isBoss: !!spec.isBoss,
      slowTimer: 0,
      flashTimer: 0,
    });
    if (spec.isBoss) {
      Audio.bearRoar();
      state.shakeTimer = 0.45;
      showBubble(215, 160, "吼——！黑熊王下山了！", 3.6);
    }
  }

  function handleNightVictory() {
    const wave = CFG.WAVES[Math.min(state.day - 1, CFG.WAVES.length - 1)];
    const r = wave.clearReward;
    // 黎明货郎把余粮部分折算成铜钱
    const foodSell = Math.floor(state.res.food * 0.6);
    const totalCoin = r.coin + foodSell;
    state.res.coin += totalCoin;
    state.res.wood += r.wood;
    state.res.hide += r.hide;
    state.stats.earnedCoin += totalCoin;
    state.projectiles = [];

    Audio.dawn();

    if (state.day >= CFG.MAX_DAYS) {
      state.phase = "END";
      showOverlay({
        seal: "深山立业",
        title: "守住黑熊王 · 前 3 天原型通关！",
        body: state.married
          ? "你与发妻阿莲齐心守住了深山小院！炊烟袅袅、谷满仓、墙牢塔高，接下来的正式版将开启<b>添丁生子、建厢房与抗击黑风寨土匪</b>！"
          : "你孤身凭一腔孤勇击退了黑熊王！下一次不妨在第 3 天前攒够 200 铜钱迎娶阿莲，体验夫妻同心守家的快乐！",
        stats: `累计击退野兽：${state.stats.kills} 只<br />累计赚取铜钱：${state.stats.earnedCoin} 枚<br />成家状态：${state.married ? `第 ${state.stats.marriedDay} 天迎娶阿莲` : "尚未成家"}`,
        buttons: [
          { label: "再开一局 · 挑战更快成家", primary: true, onClick: resetGame },
        ],
      });
      updateHud();
      return;
    }

    state.phase = "PAUSED";
    showOverlay({
      seal: `第 ${state.day} 夜告捷`,
      title: "天亮了！货郎进山收货",
      body: `昨夜成功击退所有野兽！清晨货郎进山，收购余粮并送上守夜赏钱。<br /><b>本次入账：</b>+${totalCoin} 铜钱（含卖粮 ${foodSell}）、+${r.wood} 木材、+${r.hide} 兽材。`,
      buttons: [
        {
          label: `进入第 ${state.day + 1} 天 · 继续开荒`,
          primary: true,
          onClick: () => {
            state.day += 1;
            state.dayTimer = CFG.DAY_DURATION;
            state.adUsedToday = false;
            state.phase = "DAY";
            hideOverlay();
            updateHud();
          },
        },
      ],
    });
    updateHud();
  }

  function handleDefeat() {
    state.phase = "END";
    showOverlay({
      seal: "草棚失守",
      title: "野兽冲破了农舍……",
      body: "深山险恶，单打独斗难敌兽潮。记得优先扎起木篱笆、在山口安捕兽夹，并尽早修房娶妻开启回血！",
      buttons: [
        {
          label: "🎁 绝境死守（模拟激励视频：满血复活）",
          primary: true,
          onClick: () => {
            state.houseHp = state.houseMaxHp;
            if (state.fence.level > 0) state.fence.hp = state.fence.maxHp;
            state.enemies.forEach((e) => { e.y = Math.max(120, e.y - 130); });
            state.phase = "NIGHT";
            Audio.wedding();
            hideOverlay();
            updateHud();
          },
        },
        { label: "重新开始第 1 天", primary: false, onClick: resetGame },
      ],
    });
  }

  function showOverlay(opts) {
    ui.ovSeal.textContent = opts.seal;
    ui.ovTitle.textContent = opts.title;
    ui.ovBody.innerHTML = opts.body;
    if (opts.stats) {
      ui.ovStats.innerHTML = opts.stats;
      ui.ovStats.classList.remove("hidden");
    } else {
      ui.ovStats.classList.add("hidden");
    }
    ui.ovButtons.innerHTML = "";
    opts.buttons.forEach((b) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = b.primary ? "btn-primary" : "btn-secondary";
      btn.textContent = b.label;
      btn.addEventListener("click", b.onClick);
      ui.ovButtons.appendChild(btn);
    });
    ui.overlay.classList.remove("hidden");
  }

  function hideOverlay() {
    ui.overlay.classList.add("hidden");
  }

  function resetGame() {
    state = createInitialState();
    state.phase = "DAY";
    hideOverlay();
    closePopover();
    updateHud();
    showBubble(state.farmer.x, state.farmer.y, "先点【扎木篱笆】和【荒田】，攒钱娶媳妇！", 4.5);
  }

  function update(dt) {
    clock += dt;
    if (state.shakeTimer > 0) state.shakeTimer = Math.max(0, state.shakeTimer - dt);
    if (state.bubble && state.bubble.timer > 0) state.bubble.timer -= dt;

    // 昼夜平滑过渡
    const targetNight = state.phase === "NIGHT" ? 1 : 0;
    state.nightBlend += (targetNight - state.nightBlend) * Math.min(1, dt * 3.5);

    // 粒子与飘字更新
    state.particles = state.particles.filter((p) => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 90 * dt;
      p.life -= dt;
      return p.life > 0;
    });
    state.floatTexts = state.floatTexts.filter((f) => {
      f.y -= 26 * dt;
      f.life -= dt;
      return f.life > 0;
    });

    if (state.phase !== "DAY" && state.phase !== "NIGHT") return;

    // 农夫移动
    const f = state.farmer;
    if (f.swingTimer > 0) f.swingTimer -= dt;
    if (f.attackCd > 0) f.attackCd -= dt;
    const dx = f.targetX - f.x;
    const dy = f.targetY - f.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 4) {
      f.moving = true;
      const step = Math.min(dist, CFG.FARMER.speed * dt);
      f.x += (dx / dist) * step;
      f.y += (dy / dist) * step;
    } else {
      f.moving = false;
    }

    // 氛围气泡台词
    state.quoteTimer -= dt;
    if (state.quoteTimer <= 0 && (!state.bubble || state.bubble.timer <= 0)) {
      state.quoteTimer = 8.5 + Math.random() * 5;
      const pool = state.phase === "DAY"
        ? (state.married ? CFG.QUOTES.dayMarried : CFG.QUOTES.daySolo)
        : (state.married ? CFG.QUOTES.nightMarried : CFG.QUOTES.nightSolo);
      const q = pool[Math.floor(Math.random() * pool.length)];
      const speaker = state.married && q.startsWith("阿莲") ? state.wife : state.farmer;
      showBubble(speaker.x, speaker.y, q, 3.4);
    }

    // 经济建筑生长（白昼全速，夜晚慢速）
    const growMult = state.phase === "DAY" ? 1.0 : 0.25;
    CFG.SLOTS.forEach((slot) => {
      const b = state.buildings[slot.id];
      if (!b || b.kind === "tower" || b.kind === "trap" || b.ready) return;
      b.progress += dt * growMult;
      if (b.progress >= CFG.BUILDINGS[b.kind].growTime) {
        b.ready = true;
      }
    });

    // 娶妻后阿莲自动化内务
    if (state.married) {
      if (state.phase === "DAY") {
        state.wife.harvestTimer -= dt;
        if (state.wife.harvestTimer <= 0) {
          state.wife.harvestTimer = 1.6;
          for (const slot of CFG.SLOTS) {
            const b = state.buildings[slot.id];
            if (b && b.ready) {
              harvestBuilding(slot, b, true);
              break;
            }
          }
        }
      } else if (state.phase === "NIGHT") {
        // 夜间熬汤持续回血
        if (state.fence.level > 0 && state.fence.hp > 0 && state.fence.hp < state.fence.maxHp) {
          state.fence.hp = Math.min(state.fence.maxHp, state.fence.hp + CFG.HOUSE.wifeHealPerSec * dt);
        }
        if (state.houseHp < state.houseMaxHp) {
          state.houseHp = Math.min(state.houseMaxHp, state.houseHp + CFG.HOUSE.wifeHealPerSec * 0.7 * dt);
        }
      }
    }

    // 白昼计时
    if (state.phase === "DAY") {
      state.dayTimer -= dt;
      if (state.dayTimer <= 0) {
        startNight();
      }
      updateHud();
      return;
    }

    // === 夜晚塔防战斗 ===
    if (state.spawnQueue.length > 0) {
      state.spawnTimer -= dt;
      if (state.spawnTimer <= 0) {
        const next = state.spawnQueue.shift();
        spawnEnemy(next.type);
        state.spawnTimer = state.spawnQueue.length > 0 ? state.spawnQueue[0].delay : 0;
      }
    }

    // 箭楼自动索敌开火
    CFG.SLOTS.forEach((slot) => {
      const b = state.buildings[slot.id];
      if (!b || b.kind !== "tower") return;
      b.fireCd -= dt;
      if (b.fireCd > 0) return;
      const spec = b.level === 2 ? CFG.BUILDINGS.tower.lv2 : CFG.BUILDINGS.tower.lv1;
      let target = null;
      let bestY = -1;
      for (const e of state.enemies) {
        const d = Math.hypot(e.x - slot.x, e.y - slot.y);
        if (d <= spec.range && e.y > bestY) {
          bestY = e.y;
          target = e;
        }
      }
      if (target) {
        b.fireCd = 1 / spec.fireRate;
        const ang = Math.atan2(target.y - (slot.y - 16), target.x - slot.x);
        const spd = 310;
        state.projectiles.push({
          x: slot.x,
          y: slot.y - 16,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd,
          dmg: spec.dmg,
          lv2: b.level === 2,
          life: 1.5,
        });
        Audio.arrow();
      }
    });

    // 农夫近战自动补刀
    if (f.attackCd <= 0 && state.enemies.length > 0) {
      let nearest = null;
      let minD = CFG.FARMER.attackRange;
      for (const e of state.enemies) {
        const d = Math.hypot(e.x - f.x, e.y - f.y);
        if (d <= minD) {
          minD = d;
          nearest = e;
        }
      }
      if (nearest) {
        f.attackCd = CFG.FARMER.attackCooldown;
        f.swingTimer = 0.22;
        damageEnemy(nearest, CFG.FARMER.attackDamage);
        Audio.hit();
      }
    }

    // 箭矢飞行与命中
    state.projectiles = state.projectiles.filter((p) => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) return false;
      for (const e of state.enemies) {
        if (Math.hypot(e.x - p.x, e.y - p.y) <= e.radius + 7) {
          damageEnemy(e, p.dmg);
          return false;
        }
      }
      return true;
    });

    // 敌人移动、踩陷阱、攻击防线/农舍
    const fenceAlive = state.fence.level > 0 && state.fence.hp > 0;
    const trapSlot = CFG.SLOTS.find((s) => s.id === "trap_mid");
    const trapB = state.buildings["trap_mid"];

    for (const e of state.enemies) {
      if (e.flashTimer > 0) e.flashTimer -= dt;
      if (e.slowTimer > 0) e.slowTimer -= dt;

      // 捕兽夹判定
      if (trapB && trapB.charges > 0 && e.slowTimer <= 0) {
        if (Math.hypot(e.x - trapSlot.x, e.y - trapSlot.y) <= trapSlot.r + e.radius * 0.5) {
          trapB.charges -= 1;
          e.slowTimer = CFG.BUILDINGS.trap.slowDuration;
          damageEnemy(e, CFG.BUILDINGS.trap.dmg);
          Audio.trap();
          addFloat(e.x, e.y - 16, "中陷阱！", "#6bd4ff");
        }
      }

      const spd = e.speed * (e.slowTimer > 0 ? CFG.BUILDINGS.trap.slowFactor : 1);
      const stopY = fenceAlive ? CFG.FENCE.y - 18 - e.radius : CFG.HOUSE.y - 26 - e.radius;

      if (e.y < stopY) {
        // 朝中路汇聚
        const tx = CFG.HOUSE.x + Math.sin(e.id * 1.7) * 28;
        const edx = tx - e.x;
        const edy = stopY - e.y;
        const ed = Math.hypot(edx, edy) || 1;
        e.x += (edx / ed) * spd * dt;
        e.y += (edy / ed) * spd * dt;
      } else {
        e.atkTimer -= dt;
        if (e.atkTimer <= 0) {
          e.atkTimer = e.attackCd;
          if (fenceAlive) {
            state.fence.hp -= e.dmg;
            if (e.isBoss) state.shakeTimer = 0.2;
            spawnParticles(e.x, CFG.FENCE.y, "#c9862c", 4);
            if (state.fence.hp <= 0) {
              state.fence.hp = 0;
              addFloat(CFG.FENCE.x, CFG.FENCE.y - 18, "篱笆被冲破了！", "#ff6b57");
            }
          } else {
            state.houseHp -= e.dmg;
            state.shakeTimer = 0.22;
            spawnParticles(CFG.HOUSE.x, CFG.HOUSE.y, "#e63928", 5);
            if (state.houseHp <= 0) {
              state.houseHp = 0;
              handleDefeat();
              return;
            }
          }
        }
      }
    }

    // 清理击杀的敌人
    state.enemies = state.enemies.filter((e) => e.hp > 0);

    // 守夜胜利判断
    if (state.spawnQueue.length === 0 && state.enemies.length === 0) {
      handleNightVictory();
    }
    updateHud();
  }

  function damageEnemy(e, dmg) {
    e.hp -= dmg;
    e.flashTimer = 0.1;
    addFloat(e.x, e.y - e.radius, `-${dmg}`, "#fff2b2");
    if (e.hp <= 0 && !e.deadHandled) {
      e.deadHandled = true;
      state.res.coin += e.rewardCoin;
      state.res.hide += e.rewardHide;
      state.stats.kills += 1;
      state.stats.earnedCoin += e.rewardCoin;
      spawnParticles(e.x, e.y, e.color, e.isBoss ? 24 : 9);
      addFloat(e.x, e.y - 10, `+${e.rewardCoin}钱`, "#ffe169");
      Audio.coin();
    }
  }

  // 画布点击交互
  canvas.addEventListener("pointerdown", (ev) => {
    if (state.phase !== "DAY" && state.phase !== "NIGHT") return;
    const rect = canvas.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * CFG.WIDTH;
    const y = ((ev.clientY - rect.top) / rect.height) * CFG.HEIGHT;

    // 1. 点击防线篱笆
    if (
      Math.abs(x - CFG.FENCE.x) <= CFG.FENCE.width / 2 &&
      Math.abs(y - CFG.FENCE.y) <= 22
    ) {
      openFencePopover();
      return;
    }

    // 2. 点击建筑槽位
    for (const slot of CFG.SLOTS) {
      if (Math.hypot(x - slot.x, y - slot.y) <= slot.r + 6) {
        const b = state.buildings[slot.id];
        if (b && b.ready) {
          harvestBuilding(slot, b, false);
          closePopover();
        } else {
          openSlotPopover(slot);
        }
        return;
      }
    }

    // 3. 点击农舍（白昼可弹出娶妻提示）
    if (Math.hypot(x - CFG.HOUSE.x, y - CFG.HOUSE.y) <= 46) {
      if (!state.married && state.phase === "DAY") {
        if (hasCost(CFG.HOUSE.marryCost)) {
          triggerMarry();
        } else {
          showBubble(CFG.HOUSE.x, CFG.HOUSE.y - 30, `还差聘礼：需 ${CFG.HOUSE.marryCost.coin}钱 + ${CFG.HOUSE.marryCost.wood}木`, 3);
        }
      }
      return;
    }

    // 4. 其余位置：移动农夫过去（夜晚可主动贴脸补刀）
    closePopover();
    state.farmer.targetX = Math.max(30, Math.min(CFG.WIDTH - 30, x));
    state.farmer.targetY = Math.max(150, Math.min(CFG.HEIGHT - 30, y));
  });

  // 底部按钮绑定
  ui.popClose.addEventListener("click", closePopover);
  ui.btnStart.addEventListener("click", resetGame);

  ui.btnChop.addEventListener("click", () => {
    if (state.phase !== "DAY") return;
    state.res.wood += 8;
    state.farmer.swingTimer = 0.22;
    Audio.chop();
    spawnParticles(state.farmer.x + 12, state.farmer.y - 6, "#8c5b32", 6);
    addFloat(state.farmer.x, state.farmer.y - 26, "+8 木材", "#d9f0a3");
    updateHud();
  });

  ui.btnMarry.addEventListener("click", triggerMarry);

  ui.btnAd.addEventListener("click", () => {
    if (state.adUsedToday) return;
    state.adUsedToday = true;
    state.res.coin += 100;
    state.res.hide += 1;
    state.stats.earnedCoin += 100;
    Audio.coin();
    addFloat(215, 360, "货郎奇遇：+100铜钱 +1兽材！", "#ffe169");
    showBubble(215, 390, "富商货郎进山高价收货（模拟 IAA 激励奖励）！", 3.5);
    updateHud();
  });

  ui.btnNight.addEventListener("click", startNight);

  // 启动主循环
  state = createInitialState();
  updateHud();

  function loop(ts) {
    const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0.016;
    lastTs = ts;
    update(dt);
    Renderer.render(ctx, state, clock);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
