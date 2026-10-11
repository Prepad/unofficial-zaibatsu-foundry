import { attackPlan, PHASES, collisionFormulas } from "../rules/combat.mjs";
import { checkResult } from "../rules/checks.mjs";
import { chat, clone, escape, guard, now, options, prompt, request, roundKey, serial, tokenDistance } from "./runtime.mjs";
import { evasionPenalty, occupiedVehicle } from "./vehicles.mjs";
import { createArea, smokePenalty } from "./areas.mjs";

export const PHASE_NAMES = { declaration: "Заявки", melee: "Ближний бой", ranged: "Дальний бой", aftermath: "Последствия" };
const dice = async formula => new foundry.dice.Roll(formula).evaluate();
const targetOptions = () => {
  const actors = new Map(game.actors.filter(actor => actor.visible).map(actor => [actor.uuid, actor]));
  for (const token of canvas.tokens?.placeables ?? []) if (token.visible && token.actor) actors.set(token.actor.uuid, token.actor);
  for (const token of game.user.targets ?? []) if (token.actor) actors.set(token.actor.uuid, token.actor);
  return [{ value: "", label: "Без цели: только бросок" }, ...[...actors.values()].map(actor => ({ value: actor.uuid, label: actor.name }))];
};
const damageControls = `<button type="button" data-zb-action="damage">Распределить урон / последствия</button>`;
const BLASTS = new Set(["fragmentation", "heGrenade", "airburst", "mine", "rocket", "smoke", "gas", "stun"]);

export async function attack(actor, weapon, supplied) {
  guard(actor);
  if (!weapon || weapon.type !== "weapon") throw new Error("Выберите оружие.");
  return serial(`attack:${actor.uuid}`, async () => {
    const targetToken = [...game.user.targets][0];
    const sourceToken = actor.getActiveTokens()[0];
    const data = supplied ?? await prompt(`${actor.name}: ${weapon.name}`, [
      { name: "target", label: "Цель", value: targetToken?.actor?.uuid ?? "", options: targetOptions() },
      { name: "distance", label: "Дистанция, м", type: "number", min: 0, step: "any", value: tokenDistance(sourceToken, targetToken) },
      { name: "mode", label: "Огонь", value: "single", options: options([["single", "Одиночный"], ...(weapon.system.maxAttacks >= 2 ? [["burst", "Очередь: 2 атаки / 4 патрона"]] : []), ...(weapon.system.maxAttacks >= 4 ? [["auto", "Автоматический: 4 атаки / 20 патронов"]] : [])]) },
      ...["cover", "ownCover", "dodge", "blind", "offhand", "adjacent", "strong"].map((name, i) => ({ name, label: ["Цель в укрытии", "Атакующий в укрытии", "Цель уклоняется", "Огонь вслепую", "Неосновная рука", "Союзник рядом с целью", "Силовой удар (шок)"][i], type: "checkbox" })),
      { name: "darkness", label: "Освещение", value: 0, options: options([[0, "Нормальное"], [-1, "Плохое: −1"], [-4, "Полная темнота: −4"]]) },
      { name: "smoke", label: "Дым", value: 0, options: options([[0, "Нет"], [-1, "Дым: −1"], [-2, "Густой дым: −2"]]) },
      { name: "situational", label: "Дополнительный МОД", type: "number", value: 0 }
    ]);
    if (!data) return;
    const target = data.target ? await fromUuid(data.target) : null;
    const ammunitionItem = ["heGrenade", "airGrenade"].includes(weapon.system.catalogId);
    if (ammunitionItem && !actor.items.some(item => item.system.catalogId === "grenadeLauncher")) throw new Error("Для этих боеприпасов нужен гранатомёт.");
    const destination = targetToken?.actor?.uuid === target?.uuid ? targetToken : target?.getActiveTokens()[0];
    const phase = game.combat?.getFlag("zaibatsu", "phase") ?? "declaration";
    if (roundKey() && phase !== (weapon.system.kind === "melee" ? "melee" : "ranged")) throw new Error("Сейчас другая фаза боя. Переключите фазу в панели Zaibatsu.");
    if (weapon.system.jammed) throw new Error("Сначала устраните задержку / перезарядите оружие.");
    const adaptations = actor.adaptations;
    const dark = Number(data.darkness ?? 0);
    const sensors = adaptations.has("catEyes") && dark !== -4;
    const plan = attackPlan({ ...data, cover: weapon.system.special === "airburst" ? false : data.cover, darkness: sensors ? 0 : dark, smoke: Math.min(Number(data.smoke ?? 0), smokeModifier(sourceToken, destination)),
      situational: Number(data.situational ?? 0) + evasionPenalty(actor) + evasionPenalty(target) + (occupiedVehicle(target)?.system.vehicle.speed > 0 ? -4 : 0),
      weapon: { ...(weapon.system.toObject?.() ?? weapon.system), shotgunThreshold: game.settings.get("zaibatsu", "shotgunRule") === "effective" ? weapon.system.range : 10 }, actor: { attributes: actor.system.attributes, skills: actor.system.skills, penalty: actor.penalty, ambidextrous: adaptations.has("ambidextrous"), superLimbs: adaptations.has("superArms") || adaptations.has("superLegs") }, target: target?.system,
      aim: actor.system.combatState.aimWeapon === weapon.id ? actor.system.combatState.aim ?? 0 : 0 });
    if (weapon.system.maximumRange && data.distance > weapon.system.maximumRange) throw new Error("Превышена дальность этого оружия.");
    const numeric = game.settings.get("zaibatsu", "ammunition") === "numeric";
    const expendable = weapon.system.kind === "thrown" || ammunitionItem;
    if (numeric && !expendable && plan.ammo > weapon.system.ammunition) throw new Error("Недостаточно патронов для этого режима.");
    if (expendable && weapon.system.quantity < 1) throw new Error("Нет гранат / метательных боеприпасов.");
    await actor.useMajor(`Атака: ${weapon.name}`);
    if (numeric && !expendable && plan.ammo) await weapon.update({ "system.ammunition": weapon.system.ammunition - plan.ammo });
    if (expendable) await weapon.update({ "system.quantity": weapon.system.quantity - 1 });
    for (let index = 0; index < plan.attacks; index++) {
      const roll = await new foundry.dice.Roll(`${plan.formula} + @modifier`, { modifier: plan.modifier }).evaluate();
      const result = checkResult(roll.total, 8);
      const natural = roll.dice.flatMap(die => die.results.filter(r => r.active !== false).map(r => r.result));
      if (!numeric && weapon.system.kind === "ranged" && natural.length === 2 && natural.every(value => value === 1)) {
        await weapon.update({ "system.jammed": true });
        await roll.toMessage({ speaker: foundry.documents.ChatMessage.getSpeaker({ actor }), flavor: `${escape(weapon.name)}: ${weapon.system.fired ? "патроны закончились" : "задержка оружия"}` });
        break;
      }
      const damage = result.success && !["stunner", "tranquilizer", "gas", "stun", "smoke"].includes(weapon.system.special)
        ? await dice(`${plan.damage} + ${plan.strengthBonus} + ${plan.addEffect ? Math.max(0, result.effect) : 0}`) : null;
      const event = result.success ? { amount: damage?.total ?? 0, type: plan.damageType, penetration: weapon.system.penetration,
        special: weapon.system.special, targetUuid: target?.uuid ?? "", actorUuid: actor.uuid,
        roundKey: roundKey(), phase, createdAt: now() } : null;
      if (event && destination && BLASTS.has(event.special)) event.area = { sceneId: canvas.scene.id, x: destination.center.x, y: destination.center.y, effect: result.effect };
      const message = await roll.toMessage({ speaker: foundry.documents.ChatMessage.getSpeaker({ actor }),
        flavor: `<strong>${escape(weapon.name)}</strong> → ${escape(target?.name ?? "без цели")} · ${data.distance} м<br>${plan.parts.map(p => `${escape(p.label)} ${p.value > 0 ? "+" : ""}${p.value}`).join("; ")}<br>Эффект ${result.effect}: ${result.success ? "попадание" : "промах"}${damage ? ` · ${plan.damageType === "shock" ? "шок" : "урон"} ${damage.total}` : ""}${event ? damageControls : ""}`,
        flags: { zaibatsu: { attack: { actorUuid: actor.uuid, weaponId: weapon.id, result }, damage: event } } });
      if (damage) await damage.toMessage({ speaker: foundry.documents.ChatMessage.getSpeaker({ actor }), flavor: `Урон: ${escape(weapon.name)}` });
      if (event && target) await request(actor, "queueDamage", { messageId: message.id });
      if (!result.success && data.adjacent) {
        const stray = await dice("1d6");
        await chat(actor, "Огонь рядом с союзником", `d6 = ${stray.total}: ${stray.total >= 4 ? "попадание в соседнего персонажа; выберите его на карте и примените урон" : "пуля никого не задела"}`);
        if (stray.total >= 4) {
          const strayDamage = await dice(plan.damage);
          await chat(actor, "Случайное попадание", `Урон ${strayDamage.total}${damageControls}`, { damage: { amount: strayDamage.total, type: plan.damageType, actorUuid: actor.uuid, targetUuid: "", roundKey: roundKey(), phase } });
        }
      }
    }
    await weapon.update({ "system.fired": true });
  });
}

export async function unarmed(actor) {
  const data = await prompt("Рукопашная атака", [
    { name: "skill", label: "Навык", value: "karate", options: options([["karate", "Каратэ"], ["jujutsu", "Дзюдзюцу"]]) },
    { name: "kind", label: "Приём", value: "punch", options: options([["punch", "Удар: 1d6 шока"], ["strong", "Силовой удар: 1d6+2 шока, −2"], ["throw", "Захват и бросок"], ["hold", "Захват и удержание"], ["drag", "Захват и перемещение"], ["disarm", "Обезоруживание"]]) }
  ]);
  if (!data) return;
  const weapon = { id: "unarmed", name: "Рукопашная атака", type: "weapon", system: { kind: "melee", range: 3, skill: data.skill, damage: "1d6", damageType: "shock", maxAttacks: 1 }, update: async () => {} };
  if (["punch", "strong"].includes(data.kind)) {
    const target = [...game.user.targets][0];
    return attack(actor, weapon, { target: target?.actor?.uuid ?? "", distance: tokenDistance(actor.getActiveTokens()[0], target), strong: data.kind === "strong" });
  }
  const target = [...game.user.targets][0]?.actor;
  if (!target) throw new Error("Выделите цель захвата на карте.");
  if (tokenDistance(actor.getActiveTokens()[0], [...game.user.targets][0]) > 3) throw new Error("Цель вне дистанции ближнего боя.");
  if (roundKey() && game.combat.getFlag("zaibatsu", "phase") !== "melee") throw new Error("Дождитесь фазы ближнего боя.");
  await actor.useMajor("Захват");
  const defense = Math.max(0, ...["bujutsu", "karate", "jujutsu"].map(key => target.system.skills?.[key] ?? 0));
  const result = await actor.rollSkill(data.skill, { modifier: -defense });
  if (!result.success) return;
  const message = await chat(actor, "Успешный захват", escape(data.kind), { damage: { amount: data.kind === "throw" ? 4 + (actor.system.attributes.strength.value >= 9 ? 1 : 0) : 0,
    type: "shock", special: data.kind, actorUuid: actor.uuid, targetUuid: target.uuid, roundKey: roundKey(), phase: "melee" } });
  await request(actor, "queueDamage", { messageId: message.id });
}

export async function chooseDamage(target, event) {
  if (target.system.vehicle || event.type === "shock" || ["stunner", "tranquilizer", "gas", "stun", "smoke", "hold", "drag", "disarm"].includes(event.special)) return { first: "strength", armorId: "" };
  return prompt(`Урон ${event.amount}: ${target.name}`, [
    { name: "first", label: "После ВЫН снижать сначала", value: "strength", options: options([["strength", "СИЛ"], ["dexterity", "ЛОВ"]]) },
    { name: "armorId", label: "Броня: защита от одной атаки за раунд", value: "", options: [{ value: "", label: "Сохранить броню / без брони" },
      ...target.items.filter(item => item.type === "armor" && item.system.equipped && (!event.roundKey || target.system.combatState.armorRound !== event.roundKey)).map(item => ({ value: item.id, label: `${item.name} (${item.system.protection})` })),
      ...(target.adaptations.has("subdermalArmor") && (!event.roundKey || target.system.combatState.armorRound !== event.roundKey) ? [{ value: "innate", label: "Подкожная броня (4)" }] : [])] }
  ], { text: "Урон сначала расходует ВЫН, затем выбранную характеристику и последнюю физическую характеристику." });
}
export async function queueDamage(actor, payload, user) {
  const message = game.messages.get(payload.messageId);
  const event = clone(message?.getFlag("zaibatsu", "damage"));
  if (!event || (event.actorUuid !== actor.uuid && event.targetUuid !== actor.uuid) || (!user.isGM && message.author?.id !== user.id && event.targetUuid !== actor.uuid)) throw new Error("Не найдено разрешённое событие урона.");
  if (event.area) return queueBlast(actor, message, event, user);
  if (payload.targetUuid && !event.targetUuid) {
    if (!user.isGM && !actor.testUserPermission(user, "OWNER")) throw new Error("Нет прав.");
    event.targetUuid = payload.targetUuid;
  }
  const target = await fromUuid(event.targetUuid);
  if (!target) throw new Error("Выберите цель события.");
  event.id = `${event.referenceTag ?? message.id}:${target.uuid}`;
  if (target.system.appliedEvents.includes(event.id)) return;
  const combat = game.combats.get(event.roundKey?.split(":")[0]);
  if (combat?.started && `${combat.id}:${combat.round}` === event.roundKey) {
    return serial(`combat:${combat.id}`, async () => {
      const pending = clone(combat.getFlag("zaibatsu", "pending") ?? []);
      const existing = pending.find(entry => entry.id === event.id);
      const choice = payload.choice && (user.isGM || target.testUserPermission(user, "OWNER")) ? payload.choice : null;
      if (existing) { if (choice) existing.choice = choice; }
      else pending.push({ ...event, ...(choice ? { choice } : {}) });
      await combat.setFlag("zaibatsu", "pending", pending);
    });
  }
  const choice = payload.choice && (user.isGM || target.testUserPermission(user, "OWNER")) ? payload.choice : await chooseDamage(target, event);
  if (choice) await resolveEvent(target, event, choice);
}
function smokeModifier(source, destination) {
  return smokePenalty(canvas.scene, source, destination, now());
}

export function blastProfile(special, distance, vehicle = false) {
  if (["smoke", "gas", "stun"].includes(special)) return distance <= 6 ? { formula: "0", special } : null;
  if (special === "heGrenade") return distance <= 5 ? { formula: vehicle ? "5d6" : "2d6", penetration: vehicle ? 8 : 0 } : null;
  if (special === "mine") return distance <= 10 ? { formula: vehicle ? "6d6" : distance <= 3 ? "4d6" : "2d6", penetration: vehicle ? 8 : 0 } : null;
  if (special === "rocket") return distance <= 10 ? { formula: distance <= 3 ? "6d6" : "3d6" } : null;
  if (["fragmentation", "airburst"].includes(special)) return distance <= 9 ? { formula: distance <= 3 ? "5d6" : distance <= 6 ? "3d6" : "1d6" } : null;
  return null;
}
async function queueBlast(actor, message, event, user) {
  return serial(`blast:${message.id}`, async () => {
    if (message.getFlag("zaibatsu", "blastComplete")) return;
    const scene = game.scenes.get(event.area.sceneId);
    if (!scene) throw new Error("Сцена взрыва удалена.");
    const radius = ["gas", "smoke", "stun"].includes(event.special) ? 6 : event.special === "heGrenade" ? 5 : ["mine", "rocket"].includes(event.special) ? 10 : 9;
    const duration = event.special === "smoke" ? (await dice("1d6")).total * 18 : 6;
    await createArea(scene, { source: message.id, special: event.special, x: event.area.x, y: event.area.y, radius, until: now() + duration });
    const actors = new Set();
    for (const token of scene.tokens) {
      if (!token.actor || actors.has(token.actor.uuid)) continue;
      const center = { x: token.x + token.width * scene.grid.size / 2, y: token.y + token.height * scene.grid.size / 2 };
      const distance = Math.hypot(center.x - event.area.x, center.y - event.area.y) / scene.grid.size * scene.grid.distance;
      const profile = blastProfile(event.special, distance, !!token.actor.system.vehicle);
      if (!profile) continue;
      actors.add(token.actor.uuid);
      let child = game.messages.find(entry => entry.getFlag("zaibatsu", "blastSource") === message.id && entry.getFlag("zaibatsu", "damage")?.targetUuid === token.actor.uuid);
      if (!child) {
        const amount = (await dice(`${profile.formula} + ${profile.formula === "0" ? 0 : Math.max(0, event.area.effect)}`)).total;
        child = await chat(actor, `Зона действия → ${token.actor.name}`, `Дистанция от центра ${distance.toFixed(1)} м · урон ${amount}${damageControls}`, {
          blastSource: message.id, damage: { ...event, area: null, targetUuid: token.actor.uuid, special: profile.special ?? "", penetration: profile.penetration ?? 0, amount } });
      }
      await queueDamage(actor, { messageId: child.id }, game.user);
    }
    await message.setFlag("zaibatsu", "blastComplete", true);
  });
}

export async function resolveEvent(target, event, choice = {}) {
  if (target.system.appliedEvents.includes(event.id)) return;
  const special = event.special;
  if ((target.system.vehicle && (event.type === "shock" || ["stunner", "tranquilizer", "gas", "stun", "poison"].includes(special))) || (special === "gas" && (target.adaptations.has("breathing") || target.adaptations.has("poisonImmunity")))) {
    await target.update({ "system.appliedEvents": [...target.system.appliedEvents, event.id] });
    await chat(target, "Последствия", "Цель невосприимчива к этому воздействию.");
    return;
  }
  if (["stunner", "tranquilizer", "gas", "stun"].includes(special)) {
    const result = await target.rollCharacteristic("endurance", { modifier: 0 });
    const roll = await dice(special === "stun" ? "1d3" : special === "tranquilizer" ? "2d6" : "1d6");
    const seconds = roll.total * (special === "stun" ? 6 : special === "gas" ? 600 : 60);
    if (!result.success) {
      if (special === "tranquilizer") await target.condition("paralyzed", "Парализован", 6);
      await target.condition("unconscious", "Без сознания", seconds + (special === "tranquilizer" ? 6 : 0));
      if (special === "gas" && result.effect <= -6) await target.applyDamage({ ...event, id: `${event.id}:gas`, special: "", amount: (await dice("2d6+2")).total }, choice);
    } else if (special !== "stun") await target.condition(special, "Воздействие спецоружия", seconds, special === "stunner" ? -1 : -2);
  } else if (special === "smoke") {
    await chat(target, "Дымовая граната", `Радиус 6 м, ${(await dice("1d6")).total * 3} раундов; МОД −1, в густом дыме −2 (для лазеров вдвое).`);
  } else if (["hold", "drag", "disarm", "throw"].includes(special)) {
    const attacker = await fromUuid(event.actorUuid);
    if (special === "hold") await target.condition("held", "Удерживается в захвате", 0, 0, { attackerUuid: event.actorUuid });
    if (special === "drag") await chat(target, "Перемещение в захвате", `Переместите на ${Math.floor(attacker.system.attributes.strength.value / 2)} м.`);
    if (special === "disarm") {
      const weapon = target.items.find(item => item.type === "weapon" && item.system.equipped);
      if (weapon) await weapon.update({ "system.equipped": false });
      const result = await attacker.rollCharacteristic("strength", { modifier: 0 });
      await chat(target, "Обезоруживание", result.success ? "Оружие выбито; атакующий может подобрать его." : "Оружие выбито и падает на землю.");
    }
    if (special === "throw") {
      await target.applyDamage({ ...event, special: "" }, choice);
      await target.condition("prone", "Лежит");
      await chat(target, "Бросок в захвате", `Переместите цель на ${(await dice("1d3")).total} м.`);
      return;
    }
  } else if (special === "poison") {
    if (!target.adaptations.has("poisonImmunity")) {
      const result = await target.rollCharacteristic("endurance", { modifier: 2 });
      if (result.success) await target.applyDamage({ ...event, id: `${event.id}:poison`, type: "damage", special: "", amount: (await dice("2d6")).total }, { ignoreArmor: true });
      else {
        await target.update({ "system.wounds.severity": "dead" });
        await target.condition("dead", "Смерть от яда");
      }
    }
    await target.applyDamage({ ...event, special: "" }, choice);
    return;
  } else if (special === "fire" && target.adaptations.has("secondSkin") && !target.system.conditions.some(state => state.id === "skinShed" && state.shedsAt <= now())) {
    await target.update({ "system.appliedEvents": [...target.system.appliedEvents, event.id] });
    await target.condition("skinShed", "Вторая кожа: ожидает восстановления после сна", 0, 0, { shedsAt: now() + 180 });
    await chat(target, "Вторая кожа", "Огонь поглощён защитным слоем. Через несколько минут он сходит; восстановите кожу после ночного сна.");
    return;
  } else {
    await target.applyDamage(event, choice);
    if (special === "fire") await target.condition("burning", "Горит");
    return;
  }
  await target.update({ "system.appliedEvents": [...target.system.appliedEvents, event.id] });
}

export async function advancePhase(selectedCombat = game.combat) {
  if (!game.user.isGM) throw new Error("Фазы переключает ведущий.");
  const combat = selectedCombat;
  if (!combat) throw new Error("Создайте бой и добавьте участников.");
  for (const message of game.messages) {
    const event = message.getFlag("zaibatsu", "damage");
    if (event?.area && !message.getFlag("zaibatsu", "blastComplete") && event.roundKey === `${combat.id}:${combat.round}`) {
      const actor = await fromUuid(event.actorUuid);
      if (actor) await queueDamage(actor, { messageId: message.id }, game.user);
    }
  }
  return serial(`combat:${combat.id}`, async () => {
    if (!combat.started) { await combat.startCombat(); await combat.setFlag("zaibatsu", "phase", "declaration"); return; }
    const phase = combat.getFlag("zaibatsu", "phase") ?? "declaration";
    const pending = clone(combat.getFlag("zaibatsu", "pending") ?? []);
    const collect = () => { for (const message of game.messages) {
      const event = message.getFlag("zaibatsu", "damage");
      if (!event?.targetUuid || event.area || event.roundKey !== `${combat.id}:${combat.round}` || event.phase !== phase) continue;
      const id = `${event.referenceTag ?? message.id}:${event.targetUuid}`;
      if (!pending.some(entry => entry.id === id)) pending.push({ ...clone(event), id });
    } };
    collect();
    for (let index = 0; index < pending.length; index++) {
      const event = pending[index];
      if (event.phase !== phase) continue;
      const target = await fromUuid(event.targetUuid);
      if (!target || target.system.appliedEvents.includes(event.id)) continue;
      const choice = event.choice ?? await chooseDamage(target, event);
      if (!choice) return;
      await resolveEvent(target, event, choice);
      collect();
    }
    await combat.setFlag("zaibatsu", "pending", (combat.getFlag("zaibatsu", "pending") ?? []).filter(entry => entry.phase !== phase));
    if (phase === "aftermath") {
      await combat.advanceZaibatsuRound();
      await combat.setFlag("zaibatsu", "phase", "declaration");
    } else await combat.setFlag("zaibatsu", "phase", PHASES[PHASES.indexOf(phase) + 1]);
    await chat(null, `Раунд ${combat.round}`, escape(PHASE_NAMES[combat.getFlag("zaibatsu", "phase")]));
  });
}

export async function healDialog(healer) {
  const available = new Set(healer.items.filter(item => item.system.quantity > 0).map(item => item.system.catalogId));
  const data = await prompt("Медицинская помощь", [
    { name: "target", label: "Пациент", value: [...game.user.targets][0]?.actor?.uuid ?? healer.uuid, options: targetOptions().filter(o => o.value) },
    { name: "kit", label: "Оснащение", value: available.has("advancedMedkit") ? "advancedMedkit" : available.has("medkit") ? "medkit" : "none", options: options([["none", "Нет аптечки"], ...(available.has("medkit") ? [["medkit", "Аптечка"]] : []), ...(available.has("advancedMedkit") ? [["advancedMedkit", "Медицинский набор"]] : [])]) }
  ]);
  if (!data) return;
  const target = await fromUuid(data.target);
  if (!target || target.system.vehicle) throw new Error("Выберите живого пациента.");
  const serious = target.system.wounds.severity === "serious";
  const modifier = serious ? data.kit === "advancedMedkit" ? 0 : data.kit === "medkit" ? -2 : -4 : data.kit === "none" ? 0 : 2;
  await healer.useMajor("Медицинская помощь");
  const result = await healer.rollSkill("medicine", { modifier });
  if (result.success) {
    const message = await chat(healer, "Медицинская помощь", "Успешно", { treatment: { targetUuid: target.uuid, serious } });
    await request(healer, "treatment", { messageId: message.id });
  }
}
export async function treatment(healer, { messageId }, user) {
  const message = game.messages.get(messageId);
  const data = message?.getFlag("zaibatsu", "treatment");
  if (!data || (!user.isGM && message.author?.id !== user.id)) throw new Error("Нет подтверждённого лечения.");
  const target = await fromUuid(data.targetUuid);
  const key = `treatment:${messageId}`;
  if (target.system.appliedEvents.includes(key)) return;
  await target.heal(data.serious ? 0 : 2, ["endurance"], { treated: true, stabilized: data.serious });
  await target.update({ "system.appliedEvents": [...target.system.appliedEvents, key] });
}
export async function collision(vehicle, supplied) {
  guard(vehicle);
  const data = supplied ?? await prompt("Столкновение / падение", [
    { name: "speed", label: "Скорость км/ч", type: "number", min: 0, value: vehicle.system.vehicle.speed },
    { name: "height", label: "Высота падения, м", type: "number", min: 0, value: 0 }
  ]);
  if (!data) return;
  const formulas = collisionFormulas(data.speed, data.height);
  const crew = await dice(formulas.crew);
  const damage = await dice(formulas.vehicle);
  await vehicle.applyDamage({ id: foundry.utils.randomID(), amount: damage.total }, { ignoreArmor: true });
  for (const uuid of [vehicle.system.vehicle.driver, ...(vehicle.system.vehicle.passengers ?? [])].filter(Boolean)) {
    const message = await chat(vehicle, "Травмы при столкновении", `Урон ${crew.total}${damageControls}`, { damage: { amount: crew.total, type: "damage", actorUuid: vehicle.uuid, targetUuid: uuid, phase: game.combat?.getFlag("zaibatsu", "phase"), roundKey: roundKey() } });
    await request(vehicle, "queueDamage", { messageId: message.id });
  }
}
