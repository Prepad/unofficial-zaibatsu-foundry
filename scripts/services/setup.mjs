import { Workbench } from "../applications/workbench.mjs";
import { processRequest, primaryGM, notifyAction, chat, escape, request, now, serial } from "./runtime.mjs";
import { chooseDamage } from "./combat.mjs";
import { cyberDaily, resumeCyber } from "./cyberspace.mjs";
import { CATALOG } from "../data/catalog.mjs";

export function registerSettings() {
  game.settings.registerMenu("zaibatsu", "terminal", { name: "Терминал Zaibatsu", label: "Открыть терминал", hint: "Действия, бой, создание персонажа, киберпространство и справочник.", icon: "fa-solid fa-microchip", type: Workbench, restricted: false });
  game.settings.register("zaibatsu", "ammunition", { name: "Учёт патронов", hint: "По книге точный учёт необязателен. Без подсчёта двойная единица вызывает задержку или опустошение магазина.", scope: "world", config: true, type: String, default: "dramatic", choices: { dramatic: "Без подсчёта", numeric: "Точный учёт" } });
  game.settings.register("zaibatsu", "educationRule", { name: "Дополнительные навыки при ОБР 6", hint: "В книге расходятся сводка на с. 15 и подробная таблица на с. 22.", scope: "world", config: true, type: String, default: "table", choices: { table: "Таблица с. 22: два навыка", summary: "Сводка с. 15: три навыка" } });
  game.settings.register("zaibatsu", "shotgunRule", { name: "Дистанции урона дроби", hint: "Таблица оружия задаёт 10 и 20 метров; текст дальностей использует эффективную дистанцию.", scope: "world", config: true, type: String, default: "table", choices: { table: "Таблица: 4d6 до 10 м, 2d6 до 20 м", effective: "Эффективная дистанция и её удвоенное значение" } });
  game.settings.register("zaibatsu", "networks", { scope: "world", config: false, type: Array, default: [] });
  game.settings.register("zaibatsu", "authorityGM", { scope: "world", config: false, type: String, default: "" });
  game.settings.register("zaibatsu", "cyberKey", { name: "Ключ киберпространства ведущего", hint: "Создаётся автоматически при первой сети и хранится на этом устройстве. Сохраните копию; импортируйте её при смене устройства или ведущего. 64 шестнадцатеричных символа.", scope: "client", config: true, type: String, default: "" });
  game.settings.register("zaibatsu", "migrationVersion", { scope: "world", config: false, type: Number, default: 0 });
  game.settings.register("zaibatsu", "lastWorldTime", { scope: "world", config: false, type: Number, default: -1 });
  game.keybindings.register("zaibatsu", "terminal", { name: "Терминал Zaibatsu", editable: [{ key: "KeyZ", modifiers: ["Alt"] }], onDown: () => { new Workbench(canvas.tokens?.controlled[0]?.actor).render({ force: true }); return true; } });
}
export async function migrate() {
  if (primaryGM()?.id !== game.user.id) return;
  await resumeCyber();
  for (const actor of game.actors) await actor.processDestroyedCrew();
  if (game.settings.get("zaibatsu", "migrationVersion") < 2) {
    for (const actor of game.actors) await actor.update({ "system.schemaVersion": 2 });
    for (const item of [...game.items, ...[...game.actors].flatMap(actor => [...actor.items])]) {
      const update = { "system.schemaVersion": 2 };
      if (item.type === "weapon" && !item.system.capacity && item.system.ammunition) update["system.capacity"] = item.system.ammunition;
      await item.update(update);
    }
    for (const scene of game.scenes) for (const token of scene.tokens) {
      if (!token.actorLink && token.actor) await token.actor.update({ "system.schemaVersion": 2 });
    }
    await game.settings.set("zaibatsu", "migrationVersion", 2);
  }
  const last = game.settings.get("zaibatsu", "lastWorldTime");
  if (last < 0) await game.settings.set("zaibatsu", "lastWorldTime", now());
  else if (now() > last) await worldTick(now(), now() - last);
  for (const message of game.messages) await processRequest(message);
}
export async function worldTick(time, delta) {
  if (primaryGM()?.id !== game.user.id || delta <= 0) return;
  return serial("world-time", async () => {
    const previous = game.settings.get("zaibatsu", "lastWorldTime");
    if (previous >= time) return;
    const actors = new Map(game.actors.map(actor => [actor.uuid, actor]));
    for (const scene of game.scenes) for (const token of scene.tokens) if (!token.actorLink && token.actor) actors.set(token.actor.uuid, token.actor);
    for (const actor of actors.values()) await actor.tick(time, Math.max(0, previous));
    for (const scene of game.scenes) {
      const expired = scene.templates.filter(template => template.getFlag("zaibatsu", "until") && template.getFlag("zaibatsu", "until") <= time).map(template => template.id);
      if (expired.length) await scene.deleteEmbeddedDocuments("MeasuredTemplate", expired);
    }
    await cyberDaily(time);
    await game.settings.set("zaibatsu", "lastWorldTime", time);
  });
}
export function registerHooks() {
  Hooks.on("createChatMessage", message => notifyAction(() => processRequest(message)));
  Hooks.on("updateWorldTime", (time, delta) => notifyAction(() => worldTick(time, delta)));
  Hooks.on("userConnected", () => notifyAction(() => migrate()));
  Hooks.on("updateToken", (token, changes) => {
    if (primaryGM()?.id !== game.user.id || !("x" in changes || "y" in changes) || !token.actor?.system.combatState.aim) return;
    notifyAction(() => token.actor.update({ "system.combatState.aim": 0, "system.combatState.aimWeapon": "" }));
  });
  for (const name of ["updateActor", "updateItem", "createItem", "deleteItem", "updateCombat", "createCombat", "deleteCombat", "updateSetting"]) Hooks.on(name, () => {
    for (const window of game.zaibatsu.windows) if (window.rendered && !window.busy) window.render({ force: true });
  });
  Hooks.on("getSceneControlButtons", controls => {
    if (!controls.tokens?.tools) return;
    controls.tokens.tools.zaibatsu = { name: "zaibatsu", title: "Zaibatsu: терминал", icon: "fa-solid fa-microchip", order: Object.keys(controls.tokens.tools).length, button: true, visible: true,
      onChange: () => new Workbench(canvas.tokens?.controlled[0]?.actor).render({ force: true }) };
  });
  Hooks.on("renderCombatTracker", (_app, html) => {
    const element = html instanceof HTMLElement ? html : html[0];
    if (element.querySelector(".zb-combat-button")) return;
    const button = document.createElement("button"); button.type = "button"; button.className = "zb-combat-button"; button.textContent = "Zaibatsu · фазы боя";
    button.addEventListener("click", () => new Workbench().render({ force: true }).then(app => app.changeTab("combat", "primary")));
    element.prepend(button);
  });
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const event = message.getFlag("zaibatsu", "damage");
    if (event && !html.querySelector('[data-zb-action="damage"]')) {
      const button = document.createElement("button"); button.type = "button"; button.dataset.zbAction = "damage"; button.textContent = "Распределить урон / последствия"; html.append(button);
    }
    for (const button of html.querySelectorAll('[data-zb-action="damage"]')) {
      button.addEventListener("click", () => notifyAction(async () => {
        if (!event) return;
        const target = event.targetUuid ? await fromUuid(event.targetUuid) : canvas.tokens?.controlled[0]?.actor;
        if (!target) throw new Error("Выделите токен, которому нужно применить урон.");
        const attacker = await fromUuid(event.actorUuid);
        const acting = target.isOwner ? target : attacker;
        if (!acting?.isOwner) throw new Error("Применить последствия может ведущий, владелец цели или владелец атаки.");
        const choice = target.isOwner ? await chooseDamage(target, event) : null;
        if (target.isOwner && !choice) return;
        await request(acting, "queueDamage", { messageId: message.id, targetUuid: target.uuid, ...(choice ? { choice } : {}) });
      }));
    }
    const check = message.getFlag("zaibatsu", "check");
    if (check?.graded) {
      const modifier = check.effect >= 6 ? 2 : check.effect >= 0 ? 1 : check.effect <= -6 ? -2 : -1;
      const line = document.createElement("p"); line.className = "zb-assistance"; line.textContent = `Если это помощь: МОД ${modifier > 0 ? "+" : ""}${modifier} к проверке союзника.`;
      html.append(line);
    }
  });
  Hooks.on("hotbarDrop", (_bar, data, slot) => {
    if (data.type !== "Item" || !data.uuid) return;
    notifyAction(async () => {
      const item = await fromUuid(data.uuid);
      if (!item?.actor || item.type !== "weapon") return;
      const command = `const item = await fromUuid(${JSON.stringify(item.uuid)}); if (item) await game.zaibatsu.safe(() => item.roll());`;
      const existing = game.macros.find(macro => macro.command === command && macro.isOwner);
      const macro = existing ?? await foundry.documents.Macro.create({ name: item.name, type: "script", img: item.img, command });
      await game.user.assignHotbarMacro(macro, slot);
    });
    return false;
  });
}
export async function opposed(actor, data) {
  const target = await fromUuid(data.targetUuid);
  if (!target?.system.skills || !actor.system.attributes[data.attribute] || !target.system.attributes[data.attribute]) throw new Error("Выберите двух персонажей и характеристику.");
  let winner;
  for (let attempt = 0; attempt < 20; attempt++) {
    const left = await actor.rollSkill(data.skill, { modifier: 0 });
    const right = await target.rollSkill(data.skill, { modifier: 0 });
    const difference = left.effect - right.effect || actor.system.attributes[data.attribute].value - target.system.attributes[data.attribute].value;
    if (difference) { winner = difference > 0 ? actor : target; break; }
  }
  await chat(actor, "Встречная проверка", escape(winner ? `Победитель: ${winner.name}` : "Полное равенство после повторных бросков."));
}
