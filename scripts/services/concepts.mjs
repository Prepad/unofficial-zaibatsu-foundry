import { CATALOG, CONCEPTS } from "../data/catalog.mjs";
import { SKILLS } from "../config.mjs";
import { clone, guard, prompt, serial } from "./runtime.mjs";

/** Kit choices shared by the character creator and compendium drops. */
export async function chooseConceptKit(concept) {
  if (concept.id === "commando") {
    const choice = await prompt("Вооружение спецназовца", [{ name: "kit", label: "Комплект", value: "rocket", options: [
      { value: "rocket", label: "Два БРМД" }, { value: "magneticMine", label: "Четыре магнитные мины" }
    ] }]);
    if (!choice) return null;
    return choice.kit === "magneticMine" ? Array(4).fill("magneticMine") : Array(2).fill("rocket");
  }
  if (concept.id === "gangster") {
    const options = CATALOG.filter(item => item.type === "weapon" && item.system.kind === "melee").map(item => ({ value: item.id, label: item.name }));
    const choice = await prompt("Два оружия ближнего боя", [
      { name: "one", label: "Первое", value: "katana", options }, { name: "two", label: "Второе", value: "tanto", options }
    ]);
    return choice ? [choice.one, choice.two] : null;
  }
  return [...concept.items];
}

export function catalogItemData(id) {
  const item = CATALOG.find(entry => entry.id === id);
  if (!item) throw new Error("Предмет комплекта не найден.");
  return { name: item.name, type: item.type, img: item.img, system: clone(item.system) };
}

export async function createConceptVehicle(actor) {
  return foundry.documents.Actor.create({ name: `${actor.name} — бронированный седан`, type: "vehicle",
    img: "systems/zaibatsu/assets/items/armoredSedan.png", ownership: clone(actor.ownership),
    system: { vehicle: { size: "medium", mode: "ground", armor: 12, damage: 0,
      disabledAt: 15, destroyedAt: 30, speed: 0, driver: actor.uuid, passengers: [] } } });
}

/** Apply only the selected concept; never rebuild an existing character's attributes or biography. */
export async function applyConcept(actor, document) {
  guard(actor);
  if (!actor.system.skills) throw new Error("Концепцию можно применить к агенту, NPC или андроиду.");
  const journal = document.documentName === "JournalEntryPage" ? document.parent : document;
  const concept = CONCEPTS.find(entry => entry.id === journal.getFlag("zaibatsu", "conceptId"));
  if (!concept) throw new Error("Перетащите запись из компендиума «Концепции агентов».");
  return serial(`concept:${actor.uuid}`, async () => {
    const kits = actor.getFlag("zaibatsu", "conceptKits") ?? [];
    const received = kits.includes(concept.id);
    const starting = !actor.system.created && !actor.system.concept && !actor.getFlag("zaibatsu", "initialResources");
    const canCreateVehicle = game.user.isGM || game.user.can("ACTOR_CREATE");
    const definitions = [
      { name: "skill", label: "Навык концепции (минимум уровень 1)", value: concept.skills[0], options: concept.skills.map(key => ({ value: key, label: SKILLS[key].label })) },
      { name: "kit", label: received ? "Комплект этой концепции уже выдан" : "Добавить стартовый комплект и базовое снаряжение", type: "checkbox", value: !received, disabled: received }
    ];
    if (starting) definitions.push({ name: "resources", label: "Выдать стартовые ¥4000 и 20 очков ретрогеники", type: "checkbox", value: true });
    if (concept.id === "driver" && !received) definitions.push({ name: "vehicle", label: canCreateVehicle ? "Создать связанный бронированный седан" : "Для создания седана нужны права на создание акторов", type: "checkbox", value: canCreateVehicle, disabled: !canCreateVehicle });
    const choice = await prompt(`Концепция: ${concept.name}`, definitions, {
      text: "Характеристики, возраст, дополнительные навыки, прошлое и имеющиеся предметы сохраняются. Недостающие экземпляры комплекта будут добавлены.", accept: "Применить концепцию"
    });
    if (!choice) return null;
    if (!concept.skills.includes(choice.skill)) throw new Error("Выберите навык этой концепции.");
    const kit = choice.kit && !received ? await chooseConceptKit(concept) : [];
    if (kit === null) return null;
    const ids = choice.kit && !received ? ["autopistol", "headset", ...kit] : [];
    const counts = new Map();
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    const sources = [];
    for (const [id, quantity] of counts) {
      const owned = actor.items.filter(item => item.system.catalogId === id).reduce((sum, item) => sum + item.system.quantity, 0);
      for (let index = owned; index < quantity; index++) sources.push(catalogItemData(id));
    }
    const update = { "system.concept": concept.name, [`system.skills.${choice.skill}`]: Math.max(1, actor.system.skills[choice.skill] ?? 0) };
    if (choice.kit && !received) update["flags.zaibatsu.conceptKits"] = [...kits, concept.id];
    if (starting && choice.resources) {
      update["system.money"] = Math.max(4000, actor.system.money);
      const spent = actor.items.filter(item => item.type === "retrogenic").reduce((sum, item) => sum + item.system.points, 0);
      update["system.advancement.retroPoints"] = Math.max(actor.system.advancement.retroPoints ?? 0, Math.max(0, 20 - spent));
      update["flags.zaibatsu.initialResources"] = true;
    }
    let created = [], vehicle;
    try {
      if (sources.length) created = await actor.createEmbeddedDocuments("Item", sources);
      if (concept.id === "driver" && choice.kit && !received && choice.vehicle && canCreateVehicle) {
        const gear = actor.items.find(item => item.system.catalogId === "armoredSedan");
        if (!gear?.system.linkedActorUuid) {
          vehicle = await createConceptVehicle(actor);
          await gear.update({ "system.linkedActorUuid": vehicle.uuid });
        }
      }
      await actor.update(update);
    } catch (error) {
      if (vehicle) {
        const gear = actor.items.find(item => item.system.linkedActorUuid === vehicle.uuid);
        if (gear && !created.includes(gear)) await gear.update({ "system.linkedActorUuid": "" });
        await vehicle.delete();
      }
      if (created.length) await actor.deleteEmbeddedDocuments("Item", created.map(item => item.id));
      throw error;
    }
    ui.notifications.info(`Концепция «${concept.name}» применена.`);
    return journal;
  });
}
