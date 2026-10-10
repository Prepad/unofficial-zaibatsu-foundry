import { collisionFormulas } from "../rules/combat.mjs";
import { chat, escape, now, options, prompt, request, roundKey } from "./runtime.mjs";
import { collision } from "./combat.mjs";

export function occupiedVehicle(actor) {
  return game.actors.find(vehicle => vehicle.type === "vehicle" && (vehicle.system.vehicle.driver === actor.uuid || vehicle.system.vehicle.passengers.includes(actor.uuid)));
}
export function evasionPenalty(actor) {
  const vehicle = actor?.type === "vehicle" ? actor : actor ? occupiedVehicle(actor) : null;
  const state = vehicle?.system.combatState;
  const active = roundKey() ? state?.evasionRound === roundKey() : state?.evasionUntil > now();
  return active ? -(state.evasionEffect ?? 0) : 0;
}
export async function crewDialog(vehicle) {
  const actors = game.actors.filter(actor => actor.system.skills);
  const value = await prompt("Экипаж", [
    { name: "driver", label: "Водитель", value: vehicle.system.vehicle.driver, options: [{ value: "", label: "Нет водителя" }, ...actors.map(actor => ({ value: actor.uuid, label: actor.name }))] },
    ...actors.map(actor => ({ name: actor.id, label: `Пассажир: ${actor.name}`, type: "checkbox", value: vehicle.system.vehicle.passengers.includes(actor.uuid) }))
  ]);
  if (!value) return;
  return vehicle.update({ "system.vehicle.driver": value.driver, "system.vehicle.passengers": actors.filter(actor => value[actor.id] && actor.uuid !== value.driver).map(actor => actor.uuid) });
}
export async function driveDialog(vehicle) {
  const value = await prompt("Вождение", [
    { name: "action", label: "Действие", value: "evade", options: options([["evade", "Уклонение"], ["maneuver", "Маневрирование"], ["stunt", "Трюк"], ["weave", "Петляние"], ["ram", "Таран"]]) },
    { name: "rating", label: "Рейтинг петляния", type: "number", min: 1, value: 1 },
    { name: "targetUuid", label: "Цель тарана", value: [...game.user.targets][0]?.actor?.uuid ?? "", options: [{ value: "", label: "Нет цели" }, ...game.actors.filter(actor => actor.type === "vehicle" && actor.uuid !== vehicle.uuid).map(actor => ({ value: actor.uuid, label: actor.name }))] }
  ]);
  if (value) return request(vehicle, "drive", value);
}
export async function drive(vehicle, data, _user, requestId = foundry.utils.randomID()) {
  if (vehicle.type !== "vehicle") throw new Error("Выберите транспорт.");
  if (vehicle.system.appliedEvents.includes(`drive:${requestId}`)) return;
  const driver = await fromUuid(vehicle.system.vehicle.driver);
  if (!driver) throw new Error("Назначьте водителя в экипаже.");
  if (vehicle.system.vehicle.damage >= vehicle.system.vehicle.disabledAt) throw new Error("Транспорт неисправен.");
  const skill = vehicle.system.vehicle.mode === "grav" ? "gravVehicles" : "groundVehicles";
  if (!['evade', 'maneuver', 'stunt', 'weave', 'ram'].includes(data.action)) throw new Error("Неизвестный манёвр.");
  if (data.action === "weave" && (!Number.isInteger(data.rating) || data.rating < 1 || data.rating > Math.ceil(vehicle.system.vehicle.speed / 20))) throw new Error("Рейтинг петляния должен быть от 1 до скорости / 20, округлённой вверх.");
  if (roundKey() && vehicle.system.combatState.actionRound === roundKey()) throw new Error("Главное действие транспорта уже использовано; ускоритель водителя не ускоряет машину.");
  await driver.useMajor({ evade: "Уклонение на транспорте", maneuver: "Маневрирование", stunt: "Трюк", weave: "Петляние", ram: "Таран" }[data.action]);
  await vehicle.useMajor("Вождение");
  const result = data.action === "maneuver" ? null : await driver.rollSkill(skill, { modifier: data.action === "weave" ? -data.rating : data.action === "ram" ? evasionPenalty(await fromUuid(data.targetUuid)) : 0 });
  if (data.action === "evade") await vehicle.update({ "system.combatState.evasionRound": roundKey(), "system.combatState.evasionUntil": now() + 6, "system.combatState.evasionEffect": result.effect });
  if (data.action === "weave" && !result.success) await collision(vehicle, { speed: vehicle.system.vehicle.speed, height: 0 });
  if (data.action === "ram" && result.success) {
    const target = await fromUuid(data.targetUuid);
    if (target?.type !== "vehicle") throw new Error("Выберите транспорт для тарана.");
    const roll = await new foundry.dice.Roll(collisionFormulas(vehicle.system.vehicle.speed).vehicle).evaluate();
    const sizes = { small: 1, medium: 2, large: 3 };
    const left = sizes[vehicle.system.vehicle.size]; const right = sizes[target.system.vehicle.size];
    for (const [victim, amount] of [[vehicle, right < left ? Math.floor(roll.total / 2) : roll.total], [target, left < right ? Math.floor(roll.total / 2) : roll.total]]) {
      const message = await chat(vehicle, `Таран → ${victim.name}`, `Урон ${amount}`, { damage: { actorUuid: vehicle.uuid, targetUuid: victim.uuid, amount, type: "damage", roundKey: roundKey(), phase: game.combat?.getFlag("zaibatsu", "phase") ?? "declaration" } });
      await request(vehicle, "queueDamage", { messageId: message.id });
    }
  }
  await vehicle.update({ "system.appliedEvents": [...vehicle.system.appliedEvents, `drive:${requestId}`] });
  await chat(driver, "Вождение", escape(result ? `Эффект ${result.effect}. ${result.success ? "Успех" : "Неудача"}.` : "Манёвр выполнен; переместите транспорт на карте."));
}
