import { ATTRIBUTES, SKILLS } from "../config.mjs";
import { checkResult, characteristicModifier, skillModifier } from "../rules/checks.mjs";
import { distributeDamage, healAttributes, vehicleDamage } from "../rules/combat.mjs";
import { askModifier } from "../applications/roll-dialog.mjs";
import { chat, clone, escape, guard, now, roundKey, serial, request } from "../services/runtime.mjs";

export class ZaibatsuActor extends foundry.documents.Actor {
  get adaptations() { return new Set(this.items.filter(item => item.type === "retrogenic" && item.system.equipped).map(item => item.system.effectKey)); }
  get penalty() {
    return (this.system.wounds?.penalty && !this.adaptations.has("painThreshold") ? -1 : 0)
      + (this.system.conditions ?? []).filter(state => !state.until || state.until > now()).reduce((sum, state) => sum + (state.modifier ?? 0), 0);
  }
  get incapacitated() { return this.system.wounds?.severity === "dead" || (this.system.vehicle && this.system.vehicle.damage >= this.system.vehicle.disabledAt) || (this.system.conditions ?? []).some(state => ["unconscious", "paralyzed", "knocked", "held"].includes(state.id) && (!state.until || state.until > now())); }
  get bleedInterval() { return (this.adaptations.has("regeneration") ? 7200 : 3600) * (this.system.conditions?.some(state => state.id === "slowMetabolism") ? 2 : 1); }
  async rollSkill(key, options = {}) {
    if (!Object.hasOwn(SKILLS, key)) throw new Error(`Unknown skill: ${key}`);
    return this.check({ label: SKILLS[key].label, base: skillModifier(this.system.skills[key]), target: 8, graded: true, ...options });
  }
  async rollCharacteristic(key, options = {}) {
    if (!Object.hasOwn(ATTRIBUTES, key)) throw new Error(`Unknown characteristic: ${key}`);
    const adaptationBonus = key === "strength" && this.adaptations.has("muscleMatrix") ? 4 : 0;
    return this.check({ label: game.i18n.localize(ATTRIBUTES[key]), base: characteristicModifier(this.system.attributes[key].value) + adaptationBonus, target: 10, graded: false, ...options });
  }
  async check({ label, base, target, graded = true, modifier, formula = "2d6", silent = false }) {
    guard(this);
    if (modifier === undefined) modifier = await askModifier(label);
    if (modifier === null) return null;
    const penalty = this.penalty;
    const roll = await new foundry.dice.Roll(`${formula} + @base + @modifier + @penalty`, { base, modifier, penalty }).evaluate();
    const result = checkResult(roll.total, target, { graded });
    if (!silent) await roll.toMessage({ speaker: foundry.documents.ChatMessage.getSpeaker({ actor: this }),
      flavor: `${escape(label)} · цель ${target} · эффект ${result.effect} · ${escape(game.i18n.localize(`ZAIBATSU.Outcomes.${result.outcome}`))}${penalty ? ` · состояния ${penalty}` : ""}`,
      flags: { zaibatsu: { check: { actorUuid: this.uuid, label, base, modifier, ...result } } } });
    return { roll, ...result };
  }
  async condition(id, label, seconds = 0, modifier = 0, extra = {}) {
    guard(this);
    const conditions = (this.system.conditions ?? []).filter(state => state.id !== id);
    conditions.push({ id, label, until: seconds ? now() + seconds : 0, modifier, ...extra });
    await this.update({ "system.conditions": conditions });
    await this.syncStatuses();
  }
  async clearCondition(id) {
    guard(this);
    await this.update({ "system.conditions": (this.system.conditions ?? []).filter(state => state.id !== id) });
    await this.syncStatuses();
  }
  async applyDamage(event, { first = "strength", armorId = "", ignoreArmor = false } = {}) {
    guard(this);
    return serial(this.uuid, async () => {
      if (this.system.appliedEvents.includes(event.id)) return false;
      if (!Number.isInteger(event.amount) || event.amount < 0) throw new Error("Некорректный урон.");
      const update = { "system.appliedEvents": [...this.system.appliedEvents, event.id] };
      const key = event.roundKey ?? roundKey();
      let detail;
      if (this.system.vehicle) {
        const vehicle = this.system.vehicle;
        const result = vehicleDamage(vehicle.damage, event.amount, ignoreArmor ? 0 : vehicle.armor, vehicle.disabledAt, vehicle.destroyedAt, event.penetration ?? 0);
        update["system.vehicle.damage"] = result.total;
        detail = `Повреждения ${result.total}/${vehicle.destroyedAt}; ${result.state === "destroyed" ? "уничтожен" : result.state === "disabled" ? "неисправен" : "на ходу"}.`;
      } else if (event.type === "shock") {
        const shock = this.system.wounds.shock + event.amount;
        update["system.wounds.shock"] = shock;
        if (shock >= this.system.attributes.endurance.value) {
          const conditions = this.system.conditions.filter(state => state.id !== "unconscious");
          conditions.push({ id: "unconscious", label: "Без сознания от шока", until: now() + 18, modifier: 0, shock: true });
          update["system.conditions"] = conditions;
        }
        detail = `Шок ${shock}/${this.system.attributes.endurance.value}.`;
      } else {
        const armor = this.items.get(armorId);
        if (armorId && armorId !== "innate" && (!armor || armor.type !== "armor" || !armor.system.equipped)) throw new Error("Выберите надетую броню.");
        if (armorId && key && this.system.combatState.armorRound === key) throw new Error("Броня уже защищала от атаки в этом раунде.");
        const innate = this.adaptations.has("subdermalArmor") ? 4 : 0;
        const innateUsable = !key || this.system.combatState.armorRound !== key;
        const protection = armor ? armor.system.protection : choiceInnate(armorId, innate, innateUsable);
        const result = distributeDamage(this.system.attributes, event.amount, { first, armor: ignoreArmor ? 0 : protection, penetration: event.penetration ?? 0 });
        for (const [stat, value] of Object.entries(result.values)) update[`system.attributes.${stat}.value`] = value;
        if (protection && key) update["system.combatState.armorRound"] = key;
        const wounds = clone(this.system.wounds);
        if (result.inflicted) {
          const severities = ["healthy", "minor", "wounded", "serious", "dead"];
          const incoming = result.state === "healthy" ? "minor" : result.state;
          wounds.severity = severities[Math.max(severities.indexOf(wounds.severity), severities.indexOf(incoming))];
          if (result.state !== "healthy") wounds.penalty = true;
          if (["serious", "dead"].includes(result.state)) {
            wounds.bleeding = result.state === "serious"; wounds.stabilized = false;
            wounds.nextBleed = now() + this.bleedInterval;
          }
        }
        update["system.wounds"] = wounds;
        const conditions = clone(this.system.conditions);
        if (result.inflicted && result.state === "wounded" && !conditions.some(state => state.id === "knocked")) conditions.push({ id: "knocked", label: "Сбит с ног", until: now() + 6, modifier: 0 });
        if (result.state === "serious") {
          const minutes = await new foundry.dice.Roll("2d6").evaluate();
          conditions.push({ id: "unconscious", label: "Без сознания: тяжёлое ранение", until: now() + minutes.total * 60, modifier: 0, serious: true });
        }
        if (result.state === "dead") conditions.push({ id: "dead", label: "Мёртв", until: 0, modifier: 0 });
        update["system.conditions"] = conditions;
        detail = `Броня поглотила ${result.absorbed}. Получено ${result.inflicted}. ВЫН ${result.values.endurance}, СИЛ ${result.values.strength}, ЛОВ ${result.values.dexterity}.`;
      }
      await this.update(update);
      if (this.system.wounds?.severity === "wounded" || ["serious", "dead"].includes(this.system.wounds?.severity)) {
        const accelerators = this.items.filter(item => item.type === "retrogenic" && item.system.effectKey === "accelerator" && item.system.activeUntil > now());
        if (accelerators.length) await this.updateEmbeddedDocuments("Item", accelerators.map(item => ({ _id: item.id, "system.activeUntil": 0 })));
      }
      await this.syncStatuses();
      await chat(this, "Последствия атаки", escape(detail));
      await this.processDestroyedCrew();
      return true;
    });
  }
  async processDestroyedCrew() {
    if (this.type !== "vehicle" || this.system.vehicle.damage < this.system.vehicle.destroyedAt || this.system.combatState.crewHit) return;
    const tag = `destroyed:${this.uuid}:${this.system.combatState.crewIncident ?? 0}`;
    const existing = game.messages.find(message => message.getFlag("zaibatsu", "damage")?.referenceTag === tag);
    const damage = existing?.getFlag("zaibatsu", "damage").amount ?? (await new foundry.dice.Roll("6d6").evaluate()).total;
    for (const uuid of [...new Set([this.system.vehicle.driver, ...this.system.vehicle.passengers])].filter(uuid => uuid && uuid !== this.uuid)) {
      const target = await fromUuid(uuid);
      if (!target || target.system.appliedEvents.includes(`${tag}:${uuid}`)) continue;
      const message = game.messages.find(message => message.getFlag("zaibatsu", "damage")?.referenceTag === tag && message.getFlag("zaibatsu", "damage").targetUuid === uuid)
        ?? await chat(this, "Уничтожение транспорта: экипаж", `Урон ${damage}<button type="button" data-zb-action="damage">Распределить урон</button>`, { damage: { referenceTag: tag, actorUuid: this.uuid, targetUuid: uuid, amount: damage, type: "damage", roundKey: roundKey(), phase: game.combat?.getFlag("zaibatsu", "phase") ?? "declaration" } });
      await request(this, "queueDamage", { messageId: message.id }, { defer: true });
    }
    await this.update({ "system.combatState.crewHit": true });
  }
  async syncStatuses() {
    for (const id of ["unconscious", "dead", "prone", "burning"]) {
      if (!CONFIG.statusEffects.some(effect => effect.id === id)) continue;
      const active = (this.system.conditions ?? []).some(state => state.id === id || (id === "prone" && state.id === "knocked"));
      await this.toggleStatusEffect(id, { active });
    }
  }
  async heal(amount, order, { treated = false, stabilized = false } = {}) {
    guard(this);
    if (this.system.vehicle) {
      const damage = Math.max(0, this.system.vehicle.damage - amount);
      return this.update({ "system.vehicle.damage": damage, ...(this.system.vehicle.damage >= this.system.vehicle.destroyedAt && damage < this.system.vehicle.destroyedAt ? { "system.combatState.crewHit": false, "system.combatState.crewIncident": (this.system.combatState.crewIncident ?? 0) + 1 } : {}) });
    }
    if (this.system.wounds.severity === "dead") throw new Error("Обычное лечение не воскрешает умершего.");
    const result = healAttributes(this.system.attributes, amount, order);
    const update = {};
    for (const [key, value] of Object.entries(result.values)) update[`system.attributes.${key}.value`] = value;
    if (treated) update["system.wounds.penalty"] = false;
    if (stabilized) { update["system.wounds.bleeding"] = false; update["system.wounds.stabilized"] = true; if (this.system.recovery.resting) update["system.recovery.lastRecovery"] = now(); }
    if (Object.entries(result.values).every(([key, value]) => value === this.system.attributes[key].max)) update["system.wounds"] = { severity: "healthy", penalty: false, bleeding: false, stabilized: false, nextBleed: 0, unconsciousUntil: 0, shock: this.system.wounds.shock };
    await this.update(update);
    return result;
  }
  async useMajor(action, { continued = false } = {}) {
    return serial(`actions:${this.uuid}`, async () => {
    guard(this);
    if (this.incapacitated) throw new Error("Персонаж сейчас не может действовать.");
    if (!roundKey()) return;
    const state = clone(this.system.combatState);
    const accelerator = this.system.attributes?.endurance.value > 0 && this.items.some(item => item.type === "retrogenic" && item.system.equipped && item.system.effectKey === "accelerator" && item.system.activeUntil > now());
    const actions = state.actionRound === roundKey() ? state.actionsUsed ?? 1 : 0;
    if (actions >= (accelerator ? 2 : 1)) throw new Error("Главные действия этого раунда уже использованы.");
    state.actionRound = roundKey(); state.actionsUsed = actions + 1; state.action = action;
    if (!continued) { state.aim = 0; state.aimWeapon = ""; }
    await this.update({ "system.combatState": state });
    });
  }
  async aim(weaponId) {
    const weapon = this.items.get(weaponId);
    if (!weapon || weapon.type !== "weapon" || weapon.system.kind === "melee") throw new Error("Выберите дистанционное оружие.");
    if ((this.system.skills.aiming ?? 0) < 1) throw new Error("Для прицеливания нужен навык Прицеливание 1+.");
    await this.useMajor("Прицеливание", { continued: true });
    const state = clone(this.system.combatState);
    state.aim = Math.min(3, this.system.skills.aiming, state.aimWeapon === weaponId ? (state.aim ?? 0) + 1 : 1);
    state.aimWeapon = weaponId;
    await this.update({ "system.combatState": state });
  }
  async reload(weaponId) {
    const weapon = this.items.get(weaponId);
    if (!weapon || weapon.type !== "weapon") throw new Error("Оружие не найдено.");
    const amount = Math.min(weapon.system.capacity - weapon.system.ammunition, weapon.system.reserve);
    if (game.settings.get("zaibatsu", "ammunition") === "numeric" && amount <= 0 && !weapon.system.jammed) throw new Error("Нет запасных патронов.");
    await this.useMajor(weapon.system.jammed ? "Устранение задержки" : "Перезарядка");
    await weapon.update({ "system.ammunition": weapon.system.ammunition + Math.max(0, amount), "system.reserve": weapon.system.reserve - Math.max(0, amount), "system.jammed": false, "system.fired": false });
    await chat(this, weapon.name, "Оружие готово к стрельбе.");
  }
  async tick(time, previous) {
    if (this.type === "vehicle" || this.system.wounds?.severity === "dead") return;
    const skin = this.system.conditions.find(state => state.id === "skinShed" && state.shedsAt <= time && !state.shocked);
    if (skin) {
      await this.update({ "system.conditions": this.system.conditions.map(state => state.id === "skinShed" ? { ...state, shocked: true } : state) });
      await this.condition("unconscious", "Оглушён после сброса Второй кожи", 18);
    }
    const expired = this.system.conditions.filter(state => state.until && state.until <= time);
    if (expired.length) {
      await this.update({ "system.conditions": this.system.conditions.filter(state => !state.until || state.until > time) });
      if (expired.some(state => state.shock)) { await this.update({ "system.wounds.shock": 0 }); await this.applyDamage({ id: `shock-wake:${time}`, amount: 3 }); }
      if (expired.some(state => state.serious) && this.system.wounds.severity !== "dead") {
        const update = {};
        for (const key of ["strength", "dexterity", "endurance"]) if (this.system.attributes[key].value === 0) update[`system.attributes.${key}.value`] = 1;
        await this.update(update);
      }
      await this.syncStatuses();
    }
    const fire = this.system.conditions.find(state => state.id === "burning");
    if (fire) {
      const count = Math.min(100, Math.floor((time - (fire.nextFire ?? previous)) / 6));
      for (let i = 0; i < count; i++) {
        const result = await this.rollCharacteristic("dexterity", { modifier: 0 });
        if (result.success) { await this.clearCondition("burning"); break; }
        await this.applyDamage({ id: `fire:${previous}:${i}`, amount: (await new foundry.dice.Roll("2d6").evaluate()).total });
        if (this.system.wounds.severity === "dead") return;
      }
      if (this.system.conditions.some(state => state.id === "burning")) await this.update({ "system.conditions": this.system.conditions.map(state => state.id === "burning" ? { ...state, nextFire: time } : state) });
    }
    const wounds = this.system.wounds;
    if (wounds.bleeding && wounds.nextBleed <= time) {
      const interval = this.bleedInterval;
      const count = Math.min(30, Math.floor((time - wounds.nextBleed) / interval) + 1);
      const roll = await new foundry.dice.Roll(`${count}d6`).evaluate();
      await this.applyDamage({ id: `bleed:${wounds.nextBleed}`, amount: roll.total });
      if (this.system.wounds.severity !== "dead") await this.update({ "system.wounds.nextBleed": time + interval });
    }
    if (this.system.recovery.resting && this.system.wounds.severity !== "dead") {
      const restStart = this.system.recovery.lastRecovery;
      const interval = this.system.wounds.severity === "serious" ? 86400 : 3600;
      const periods = Math.floor((time - restStart) / interval);
      if (periods > 0 && (!this.system.wounds.bleeding)) {
        await this.heal(periods * (interval === 3600 && this.adaptations.has("regeneration") ? 2 : 1), interval === 3600 ? ["endurance"] : undefined);
        await this.update({ "system.recovery.lastRecovery": restStart + periods * interval });
      }
      if (time - (this.system.recovery.started ?? restStart) >= 28800) await this.clearCondition("skinShed");
    }
  }
}

function choiceInnate(armorId, innate, usable) { return armorId === "innate" && usable ? innate : 0; }
