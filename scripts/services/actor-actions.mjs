import { CharacterCreator } from "../applications/creator.mjs";
import { CATALOG } from "../data/catalog.mjs";
import { PROCEDURES, SUITS } from "../rules/cyberspace.mjs";
import { attack, unarmed, advancePhase, healDialog, collision, chooseDamage } from "./combat.mjs";
import { createNetwork } from "./cyberspace.mjs";
import { importCatalog, importAll, createVehicle, createNPC, advancement, addAdaptation } from "./campaign.mjs";
import { ATTRIBUTES, SKILLS } from "../config.mjs";
import { crewDialog, driveDialog } from "./vehicles.mjs";
import { readNetwork, writeNetwork } from "./vault.mjs";
import { chat, escape, guard, now, options, prompt, request, roundKey, serial } from "./runtime.mjs";

const chooseWeapon = actor => prompt("Выберите оружие", [{ name: "id", label: "Оружие", value: actor.items.find(item => item.type === "weapon")?.id ?? "", options: actor.items.filter(item => item.type === "weapon").map(item => ({ value: item.id, label: item.name })) }]);

/** Shared command handling for actor sheets, item menus and the GM terminal. */
export async function executeActorCommand(actor, command, data = {}) {
  if (command === "creator") return new CharacterCreator().render({ force: true });
  if (command === "npc") return createNPC();
  if (command === "vehicle") return createVehicle();
  if (command === "network") return createNetwork();
  if (command === "authority") {
    if (!game.user.isGM) throw new Error("Нужны права ведущего.");
    const value = await prompt("Ведущий правил Zaibatsu", [{ name: "id", label: "Кто обрабатывает действия", value: game.settings.get("zaibatsu", "authorityGM"), options: game.users.filter(user => user.isGM).map(user => ({ value: user.id, label: user.name ?? user.id })) }]);
    if (value) await game.settings.set("zaibatsu", "authorityGM", value.id);
    return;
  }
  if (command === "manageNetwork") {
    if (!game.user.isGM) throw new Error("Нужны права ведущего.");
    const document = await fromUuid(data.uuid);
    const state = await readNetwork(document);
    const sessions = await Promise.all(Object.entries(state.sessions).map(async ([uuid, session], index) => ({ uuid, session, index, name: (await fromUuid(uuid))?.name ?? "Удалённый агент" })));
    const value = await prompt(state.name, [
      { name: "blackICE", label: "Чёрный ЛЕД", type: "checkbox", value: state.blackICE },
      ...state.nodes.map(node => ({ name: node.id, label: `Подсистема: ${node.name}`, type: "checkbox", value: !node.disabled, help: "Включена, если отмечена." })),
      ...sessions.flatMap(entry => [{ name: `unlock${entry.index}`, label: `Снять тег: ${entry.name}`, type: "checkbox" }, { name: `disconnect${entry.index}`, label: `Принудительно завершить соединение: ${entry.name}`, type: "checkbox" }])
    ], { text: `Осталось карт системы: ${state.system.length}. Основная колода: ${state.main.length}. Активных процедур: ${state.tasks.length}.` });
    if (!value) return;
    return serial(`network:${document.uuid}`, async () => {
      const current = await readNetwork(document);
      current.blackICE = value.blackICE;
      for (const node of current.nodes) node.disabled = !value[node.id];
      for (const entry of sessions) {
        const session = current.sessions[entry.uuid];
        if (!session) continue;
        if (value[`unlock${entry.index}`]) session.blockedUntil = 0;
        if (value[`disconnect${entry.index}`]) { session.connected = false; session.ice = null; session.blackICE = null; }
        const actor = await fromUuid(entry.uuid);
        if (actor?.system.cyber.networkUuid === document.uuid) await actor.update({ "system.cyber.connected": session.connected, "system.cyber.blockedUntil": session.blockedUntil, "system.cyber.ice": session.ice, "system.cyber.blackICE": session.blackICE });
      }
      return writeNetwork(document, current);
    });
  }
  if (command === "importAll") return importAll();
  if (command === "phase") return advancePhase();
  if (command === "import") return importCatalog(actor, data.id);
  if (command === "buy") return importCatalog(actor, data.id, { purchase: true });
  if (command === "inspect") {
    const entry = CATALOG.find(item => item.id === data.id);
    const system = entry.system;
    const details = [system.damage ? `Урон: ${system.damage}` : "", system.range ? `Эффективная дальность: ${system.range} м` : "", system.protection ? `Броня: ${system.protection}` : "", system.rating ? `Рейтинг: ${system.rating}` : "", system.points ? `Очки ретрогеники: ${system.points}` : "", `Места в инвентаре: ${system.slots}`, system.price ? `Цена: ¥${system.price}` : "Цена не указана"].filter(Boolean);
    return foundry.applications.api.DialogV2.prompt({ window: { title: entry.name }, content: `<p>${escape(system.description || "")}</p><ul>${details.map(detail => `<li>${escape(detail)}</li>`).join("")}</ul>`, ok: { label: "Закрыть" }, rejectClose: false });
  }
  if (command === "time") {
    if (!game.user.isGM) throw new Error("Время меняет ведущий.");
    const value = await prompt("Пропустить время", [{ name: "minutes", label: "Минуты", type: "number", min: 0, value: 60 }]);
    if (value) return game.time.advance(value.minutes * 60);
    return;
  }
  guard(actor);
  if (!actor.system.skills && ["attack", "aim", "reload", "unarmed", "aid", "advancement", "adaptation", "condition", "rest", "retrogen", "escapeHold", "connect", "guess", "breakICE", "procedure", "remoteCommand", "disconnect", "escape", "contact", "opposed", "identity"].includes(command)) throw new Error("Для этого действия выберите агента, NPC или андроида.");
  if (command === "sheet") return actor.sheet.render({ force: true });
  if (command === "attack" || command === "aim" || command === "reload") {
    const chosen = data.itemId ? { id: data.itemId } : await chooseWeapon(actor);
    if (!chosen?.id) return;
    const weapon = actor.items.get(chosen.id);
    if (weapon?.type !== "weapon") throw new Error("Оружие не найдено в инвентаре.");
    if (command === "attack") return attack(actor, weapon);
    return actor[command](chosen.id);
  }
  if (command === "itemInfo") {
    const item = actor.items.get(data.itemId);
    if (!item) throw new Error("Предмет не найден в инвентаре.");
    return chat(actor, item.name, escape(item.system.description).replaceAll("\n", "<br>"));
  }
  if (command === "linkedActor") {
    const item = actor.items.get(data.itemId);
    const linked = item?.system.linkedActorUuid ? await fromUuid(item.system.linkedActorUuid) : null;
    if (!linked?.visible) throw new Error("Связанный транспорт недоступен.");
    return linked.sheet.render({ force: true });
  }
  if (command === "unarmed") return unarmed(actor);
  if (command === "aid") return healDialog(actor);
  if (command === "collision") return collision(actor);
  if (command === "crew") return crewDialog(actor);
  if (command === "drive") return driveDialog(actor);
  if (command === "advancement") return advancement(actor);
  if (command === "adaptation") return addAdaptation(actor, data.id);
  if (command === "clearCondition") return actor.clearCondition(data.id);
  if (command === "condition") {
    const value = await prompt("Состояние", [
      { name: "label", label: "Название", value: "Усталость" }, { name: "seconds", label: "Длительность, с (0 — постоянно)", type: "number", min: 0, value: 0 },
      { name: "modifier", label: "МОД ко всем проверкам", type: "number", value: -1 }
    ]);
    if (value) return actor.condition(foundry.utils.randomID(), value.label, value.seconds, value.modifier);
  }
  if (command === "manualDamage") {
    const value = await prompt("Ручной урон", [{ name: "amount", label: "Количество", type: "number", min: 0, value: 1 }, { name: "type", label: "Вид", value: "damage", options: options([["damage", "Ранение"], ["shock", "Шок"]]) }]);
    if (!value) return;
    const event = { ...value, id: foundry.utils.randomID(), roundKey: roundKey() };
    const choice = await chooseDamage(actor, event);
    if (choice) return actor.applyDamage(event, choice);
  }
  if (command === "heal") {
    if (actor.system.vehicle) {
      const value = await prompt("Ремонт корпуса", [{ name: "amount", label: "Очки ремонта", type: "number", min: 0, value: 2 }]);
      if (value) return actor.heal(value.amount);
      return;
    }
    const value = await prompt("Восстановление / ремонт", [{ name: "amount", label: "Очки", type: "number", min: 0, value: 2 }, { name: "first", label: "Восстанавливать сначала", value: "endurance", options: options([["endurance", "ВЫН"], ["strength", "СИЛ"], ["dexterity", "ЛОВ"]]) }, { name: "treated", label: "Раны обработаны: снять штраф", type: "checkbox" }, { name: "stabilized", label: "Остановить ухудшение серьёзных ран", type: "checkbox" }]);
    if (value) return actor.heal(value.amount, [value.first, ...["endurance", "strength", "dexterity"].filter(key => key !== value.first)], value);
  }
  if (command === "rest") {
    const resting = !actor.system.recovery.resting;
    await actor.update({ "system.recovery": { resting, lastRecovery: now(), started: now() } });
    return chat(actor, "Отдых", resting ? "Отдых начат. Восстановление произойдёт при продвижении мирового времени ведущим." : "Отдых завершён.");
  }
  if (command === "declare") {
    const value = await prompt("Заявка на раунд", [{ name: "declaration", label: "Что делает агент", type: "textarea", value: actor.system.combatState.declaration ?? "" }]);
    if (value) return actor.update({ "system.combatState.declaration": value.declaration });
  }
  if (command === "minor" || command === "major") {
    const value = await prompt(command === "major" ? "Главное действие" : "Малое действие", [{ name: "action", label: "Действие", value: command === "major" ? "Бег / продолжительное действие" : "Движение / уклонение / укрытие" }]);
    if (!value) return;
    if (command === "major") await actor.useMajor(value.action);
    else await actor.update({ "system.combatState.aim": 0, "system.combatState.aimWeapon": "" });
    return chat(actor, value.action, escape(`Движение: ${actor.adaptations.has("superLegs") ? "6 м; бег 24 м" : "6 м; бег 12 м"}; скрытно / сложная местность 3 м.`));
  }
  if (command === "escapeHold") {
    const result = await actor.rollCharacteristic("strength");
    if (result?.success) return actor.clearCondition("held");
  }
  if (command === "retrogen") {
    const items = actor.items.filter(item => item.type === "retrogenic" && item.system.equipped);
    const selected = data.itemId ? { id: data.itemId } : await prompt("Использовать адаптацию", [{ name: "id", label: "Ретрогеника", value: items[0]?.id ?? "", options: items.map(item => ({ value: item.id, label: item.name })) }]);
    if (!selected?.id) return;
    const item = items.find(item => item.id === selected.id);
    if (!item) throw new Error("Адаптация должна быть установлена и включена.");
    const key = item.system.effectKey;
    if (item.system.cooldownUntil > now()) throw new Error("Адаптация ещё восстанавливается.");
    if (key === "accelerator") {
      if (actor.system.attributes.endurance.value === 0 || actor.system.wounds.severity === "dead") throw new Error("Ускоритель отключается при ранении.");
      await item.update({ "system.activeUntil": now() + 600, "system.cooldownUntil": now() + 4200 });
    } else if (key === "transmorph") await item.update({ "system.activeUntil": now() + ((await new foundry.dice.Roll("1d6+1").evaluate()).total * 3600) });
    else if (key === "slowMetabolism") {
      const sleeping = actor.system.conditions.some(state => state.id === "slowMetabolism");
      if (sleeping) {
        const state = actor.system.conditions.find(state => state.id === "slowMetabolism");
        if (now() - state.started < 60) throw new Error("Замедление длится не меньше минуты.");
        const result = await actor.rollCharacteristic("endurance");
        if (result?.success) await actor.clearCondition("slowMetabolism");
      } else { await actor.condition("slowMetabolism", "Замедленный метаболизм", 0, 0, { started: now() }); if (actor.system.wounds.bleeding) await actor.update({ "system.wounds.nextBleed": now() + 7200 }); }
    }
    else if (key === "claws") {
      return attack(actor, { id: item.id, type: "weapon", name: item.name, system: { skill: "bujutsu", kind: "melee", range: 3, damage: "2d6+1", damageType: "damage", maxAttacks: 1 }, update: async () => {} });
    } else if (key === "fangs") {
      if (roundKey()) throw new Error("По книге укус в шею невозможен во время боя.");
      return attack(actor, { id: item.id, type: "weapon", name: item.name, system: { skill: "bujutsu", kind: "melee", range: 3, damage: "2", damageType: "shock", special: "poison", maxAttacks: 1 }, update: async () => {} });
    }
    return chat(actor, item.name, escape(item.system.description));
  }
  if (command === "connect") {
    const decks = actor.items.filter(item => item.type === "cyberdeck");
    const value = await prompt("Подключение к киберпространству", [
      { name: "networkUuid", label: "Сеть", value: game.settings.get("zaibatsu", "networks")[0]?.uuid ?? "", options: game.settings.get("zaibatsu", "networks").map(network => ({ value: network.uuid, label: network.name })) },
      { name: "deckId", label: "Дека", value: data.itemId ?? decks[0]?.id ?? "", options: decks.map(item => ({ value: item.id, label: `${item.name} · ${item.system.rating} программ` })) },
      ...actor.items.filter(item => item.type === "program").map(item => ({ name: item.id, label: `${item.name}: рейтинг ${item.system.rating}`, type: "checkbox" }))
    ]);
    if (!value) return;
    return request(actor, "cyber", { action: "connect", networkUuid: value.networkUuid, deckId: value.deckId, programs: actor.items.filter(item => item.type === "program" && value[item.id]).map(item => item.id) });
  }
  if (["disconnect", "escape"].includes(command)) return request(actor, "cyber", { action: command });
  if (command === "guess") {
    const nodes = actor.system.cyber.networkNodes ?? [];
    const node = nodes.find(node => node.id === data.node);
    const value = await prompt(`Взлом: ${node.name}`, [{ name: "guess", label: node.easy ? "Цвет карты" : "Масть карты", value: node.easy ? "black" : "spades", options: node.easy ? options([["black", "Чёрная"], ["red", "Красная"]]) : options(Object.entries(SUITS)) }]);
    if (value) return request(actor, "cyber", { action: "guess", node: node.id, ...value });
  }
  if (command === "breakICE") {
    const programs = actor.items.filter(item => item.type === "program" && item.system.icebreaker && actor.system.cyber.programs?.includes(item.id) && !actor.system.cyber.used?.includes(item.id));
    const value = await prompt("ЛЕДокол", [{ name: "programId", label: "Программа (рейтинг уменьшится на 1 навсегда)", value: data.itemId ?? "", options: [{ value: "", label: "Нет подходящей программы / принять последствия" }, ...programs.map(item => ({ value: item.id, label: `${item.name}: ${item.system.rating}` }))] }]);
    if (value) return request(actor, "cyber", { action: "breakICE", ...value });
  }
  if (command === "procedure") {
    const cyber = actor.system.cyber;
    const programs = actor.items.filter(item => cyber.programs?.includes(item.id) && !cyber.used?.includes(item.id));
    const value = await prompt("Специальная процедура", [
      { name: "procedure", label: "Процедура", value: "search", options: options(Object.entries(PROCEDURES)) },
      { name: "node", label: "Подсистема", value: cyber.node, options: (cyber.networkNodes ?? []).filter(node => cyber.access?.includes(node.id)).map(node => ({ value: node.id, label: node.name })) },
      { name: "programId", label: "Программа", value: data.itemId ?? programs[0]?.id ?? "", options: programs.map(item => ({ value: item.id, label: `${item.name} · ${item.system.rating}` })) },
      { name: "amount", label: "Сумма кражи, ¥", type: "number", min: 0, max: 2000000, value: 10000 },
      { name: "interceptor", label: "Рейтинг вражеского перехватчика", type: "number", min: 0, value: 0 },
      { name: "distance", label: "Дистанция удалённого контроля, м", type: "number", min: 0, value: 0 },
      { name: "fragments", label: "Число фрагментов поиска", type: "number", min: 1, max: 3, value: 1 },
      { name: "identity", label: "Имя новой личности", value: "" },
      { name: "delay", label: "Логическая бомба: задержка, с", type: "number", min: 60, value: 3600 }
    ]);
    if (value) return request(actor, "cyber", { action: "procedure", ...value });
  }
  if (command === "remoteCommand") {
    const value = await prompt("Удалённая команда", [{ name: "command", label: "Команда устройству", value: "Открыть дверь" }]);
    if (value) return request(actor, "cyber", { action: "remoteCommand", ...value });
  }
  if (command === "contact") {
    const value = await prompt("Контакт", [{ name: "name", label: "Имя / роль", value: "" }, { name: "notes", label: "Отношения и услуги", type: "textarea" }]);
    if (value?.name.trim()) return actor.update({ "system.contacts": [...actor.system.contacts, { ...value, loyalty: 0 }] });
  }
  if (command === "identity") {
    const items = actor.items.filter(item => item.system.identity.threshold);
    const value = data.itemId ? { id: data.itemId } : await prompt("Использовать ID-карту", [{ name: "id", label: "Документ", value: items[0]?.id ?? "", options: items.map(item => ({ value: item.id, label: item.name })) }]);
    if (!value?.id) return;
    const item = items.find(item => item.id === value.id);
    if (!item) throw new Error("В этом предмете не задан порог проверки ID-карты.");
    const roll = await new foundry.dice.Roll("2d6").evaluate();
    const detected = roll.total >= item.system.identity.threshold;
    await roll.toMessage({ speaker: foundry.documents.ChatMessage.getSpeaker({ actor }), flavor: `${escape(item.name)}: ${detected ? "подделка обнаружена" : "проверка пройдена"} (порог ${item.system.identity.threshold}+)` });
    if (detected) await item.update({ "system.identity.detected": true });
  }
  if (command === "opposed") {
    const value = await prompt("Встречная проверка", [{ name: "targetUuid", label: "Соперник", value: [...game.user.targets][0]?.actor?.uuid ?? "", options: game.actors.filter(a => a.visible && a.system.skills).map(a => ({ value: a.uuid, label: a.name })) }, { name: "skill", label: "Навык", value: "bujutsu", options: options(Object.entries(SKILLS).map(([key, entry]) => [key, entry.label])) }, { name: "attribute", label: "Характеристика при равенстве", value: "strength", options: options(Object.entries(ATTRIBUTES).map(([key, label]) => [key, game.i18n.localize(label)])) }]);
    if (value) return request(actor, "opposed", value);
  }
}
