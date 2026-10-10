import { CharacterCreator } from "./creator.mjs";
import { CATALOG } from "../data/catalog.mjs";
import { PROCEDURES, SUITS, cardLabel } from "../rules/cyberspace.mjs";
import { attack, unarmed, advancePhase, healDialog, collision, PHASE_NAMES, chooseDamage } from "../services/combat.mjs";
import { createNetwork } from "../services/cyberspace.mjs";
import { importCatalog, importAll, createVehicle, createNPC, advancement, addAdaptation } from "../services/campaign.mjs";
import { ATTRIBUTES, SKILLS, ITEM_TYPES, WOUND_NAMES } from "../config.mjs";
import { crewDialog, driveDialog } from "../services/vehicles.mjs";
import { readNetwork, writeNetwork } from "../services/vault.mjs";
import { chat, clone, escape, guard, now, notifyAction, options, prompt, request, roundKey, serial } from "../services/runtime.mjs";

const chooseWeapon = actor => prompt("Выберите оружие", [{ name: "id", label: "Оружие", value: actor.items.find(item => item.type === "weapon")?.id ?? "", options: actor.items.filter(item => item.type === "weapon").map(item => ({ value: item.id, label: item.name })) }]);
export class Workbench extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  static DEFAULT_OPTIONS = { classes: ["zaibatsu", "zb-workbench"], position: { width: 920, height: 780 }, window: { title: "Zaibatsu · Терминал", resizable: true }, actions: { do: Workbench.perform } };
  static PARTS = { main: { template: "systems/zaibatsu/templates/applications/workbench.hbs", scrollable: [".zb-panel-content"] } };
  static TABS = { primary: { initial: "actions", tabs: [{ id: "actions", label: "Действия" }, { id: "combat", label: "Бой" }, { id: "cyber", label: "Киберпространство" }, { id: "catalog", label: "Справочник" }] } };
  constructor(actor, options = {}) { super(options); this.actorUuid = actor?.uuid ?? ""; }
  get actor() { return this.currentActor; }
  async _prepareContext() {
    const actors = game.actors.filter(actor => actor.isOwner);
    this.currentActor = this.actorUuid ? await fromUuid(this.actorUuid) : game.user.character ?? actors[0];
    if (this.currentActor && !this.currentActor.isOwner) this.currentActor = null;
    if (this.currentActor) this.actorUuid = this.currentActor.uuid;
    const actor = this.currentActor;
    if (actor && !actors.some(entry => entry.uuid === actor.uuid)) actors.push(actor);
    const cyber = actor?.system.cyber ?? {};
    return { tabs: this._prepareTabs("primary"), gm: game.user.isGM, actor, system: actor?.system, vehicle: actor?.system.vehicle, transport: actor?.type === "vehicle", agent: !!actor?.system.skills, woundLabel: WOUND_NAMES[actor?.system.wounds?.severity] ?? "Корпус транспорта",
      agents: actors.map(actor => ({ uuid: actor.uuid, name: actor.name, selected: actor.uuid === this.actorUuid })),
      conditions: actor?.system.conditions?.map(state => ({ ...state, remaining: state.until ? `${Math.max(0, Math.ceil(state.until - now()))} с` : "постоянно" })),
      penalty: actor?.penalty ?? 0, retroPoints: actor?.system.advancement?.retroPoints ?? 0,
      combat: game.combat, phase: PHASE_NAMES[game.combat?.getFlag("zaibatsu", "phase") ?? "declaration"],
      combatants: game.combat?.combatants.filter(combatant => !combatant.hidden || game.user.isGM).map(combatant => ({ name: combatant.name, actorUuid: combatant.actor?.uuid, declaration: combatant.actor?.system.combatState?.declaration ?? "", action: combatant.actor?.system.combatState?.actionRound === roundKey() ? combatant.actor.system.combatState.action : "Доступно", aim: combatant.actor?.system.combatState?.aim ?? 0 })),
      pending: (game.combat?.getFlag("zaibatsu", "pending") ?? []).map(event => ({ ...event, targetName: game.actors.get(event.targetUuid?.split(".").at(-1))?.name ?? event.targetUuid, chosen: !!event.choice })),
      cyber: { ...cyber, revealed: (cyber.revealed ?? []).map(entry => ({ node: entry.node, label: cardLabel(entry.card) })) },
      catalog: CATALOG.map(entry => ({ ...entry, typeLabel: game.i18n.localize(ITEM_TYPES[entry.type]), priceLabel: entry.system.price ? `¥${entry.system.price}` : "Цена не указана", isRetrogenic: entry.type === "retrogenic" })),
      networks: game.settings.get("zaibatsu", "networks"), programs: actor?.items.filter(item => item.type === "program").map(item => ({ id: item.id, name: item.name, rating: item.system.rating, used: cyber.used?.includes(item.id) })) };
  }
  async _onRender(context, options) {
    await super._onRender(context, options);
    game.zaibatsu.windows.add(this);
    this.element.querySelector('[name="actorUuid"]').addEventListener("change", async event => { this.actorUuid = event.target.value; await this.render({ force: true }); });
    this.element.querySelector('[name="catalogSearch"]').addEventListener("input", event => {
      const text = event.target.value.toLocaleLowerCase();
      for (const row of this.element.querySelectorAll("[data-search]")) row.hidden = !row.dataset.search.toLocaleLowerCase().includes(text);
    });
  }
  _onClose(options) { game.zaibatsu.windows.delete(this); super._onClose(options); }
  static async perform(_event, target) {
    if (this.busy) return;
    this.busy = true;
    try { return await notifyAction(async () => { await this.execute(target.dataset.command, target.dataset); await this.render({ force: true }); }); }
    finally { this.busy = false; }
  }
  async execute(command, data) {
    const actor = this.actor;
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
      const chosen = await chooseWeapon(actor);
      if (!chosen?.id) return;
      if (command === "attack") return attack(actor, actor.items.get(chosen.id));
      return actor[command](chosen.id);
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
      const selected = await prompt("Использовать адаптацию", [{ name: "id", label: "Ретрогеника", value: items[0]?.id ?? "", options: items.map(item => ({ value: item.id, label: item.name })) }]);
      if (!selected?.id) return;
      const item = actor.items.get(selected.id);
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
        { name: "deckId", label: "Дека", value: decks[0]?.id ?? "", options: decks.map(item => ({ value: item.id, label: `${item.name} · ${item.system.rating} программ` })) },
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
      const value = await prompt("ЛЕДокол", [{ name: "programId", label: "Программа (рейтинг уменьшится на 1 навсегда)", value: "", options: [{ value: "", label: "Нет подходящей программы / принять последствия" }, ...programs.map(item => ({ value: item.id, label: `${item.name}: ${item.system.rating}` }))] }]);
      if (value) return request(actor, "cyber", { action: "breakICE", ...value });
    }
    if (command === "procedure") {
      const cyber = actor.system.cyber;
      const programs = actor.items.filter(item => cyber.programs?.includes(item.id) && !cyber.used?.includes(item.id));
      const value = await prompt("Специальная процедура", [
        { name: "procedure", label: "Процедура", value: "search", options: options(Object.entries(PROCEDURES)) },
        { name: "node", label: "Подсистема", value: cyber.node, options: (cyber.networkNodes ?? []).filter(node => cyber.access?.includes(node.id)).map(node => ({ value: node.id, label: node.name })) },
        { name: "programId", label: "Программа", value: programs[0]?.id ?? "", options: programs.map(item => ({ value: item.id, label: `${item.name} · ${item.system.rating}` })) },
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
      const value = await prompt("Использовать ID-карту", [{ name: "id", label: "Документ", value: items[0]?.id ?? "", options: items.map(item => ({ value: item.id, label: item.name })) }]);
      if (!value?.id) return;
      const item = actor.items.get(value.id);
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
}
