import { CATALOG, VEHICLES } from "../data/catalog.mjs";
import { ATTRIBUTES, SKILLS } from "../config.mjs";
import { chat, clone, escape, guard, options, prompt } from "./runtime.mjs";
import { background } from "../applications/creator.mjs";

export const RANKS = [
  { rank: 1, points: 0, name: "Агент", money: 4000, skill: 0 },
  { rank: 2, points: 3, name: "Старший агент", money: 6000, skill: 1 },
  { rank: 3, points: 9, name: "Супервайзер", money: 8000, skill: 0 },
  { rank: 4, points: 18, name: "Помощник руководителя проекта", money: 10000, skill: 1 },
  { rank: 5, points: 30, name: "Руководитель проекта", money: 12000, skill: 1 },
  { rank: 6, points: 45, name: "Помощник начальника отдела", money: 14000, skill: 1 },
  { rank: 7, points: 63, name: "Начальник отдела", money: 16000, skill: 0 }
];
export async function importCatalog(actor, id, { purchase = false } = {}) {
  if (actor) guard(actor);
  else if (!game.user.isGM) throw new Error("Справочник мира наполняет ведущий.");
  const entry = CATALOG.find(item => item.id === id);
  if (!entry) throw new Error("Предмет не найден.");
  const data = { name: entry.name, type: entry.type, img: entry.img, system: clone(entry.system) };
  if (purchase) {
    if (!entry.system.price) throw new Error("Цена не указана в справочнике. Добавьте предмет и согласуйте цену с ведущим.");
    if (actor.system.money < entry.system.price) throw new Error("Недостаточно денег.");
  }
  if (actor) {
    const [item] = await actor.createEmbeddedDocuments("Item", [data]);
    if (purchase) await actor.update({ "system.money": actor.system.money - entry.system.price });
    return item;
  }
  const existing = game.items.find(item => item.system.catalogId === id);
  return existing ?? foundry.documents.Item.create(data);
}
export async function importAll() {
  if (!game.user.isGM) throw new Error("Нужны права ведущего.");
  const missing = CATALOG.filter(entry => !game.items.some(item => item.system.catalogId === entry.id));
  const folder = game.folders.find(folder => folder.type === "Item" && folder.name === "Zaibatsu") ?? await foundry.documents.Folder.create({ name: "Zaibatsu", type: "Item" });
  return foundry.documents.Item.createDocuments(missing.map(entry => ({ name: entry.name, type: entry.type, img: entry.img, system: clone(entry.system), folder: folder.id })));
}
export async function createVehicle(preset) {
  if (!preset) {
    const data = await prompt("Создать транспорт", [{ name: "preset", label: "Тип", value: 0, options: VEHICLES.map((v, i) => ({ value: i, label: v.name })) }]);
    if (!data) return;
    preset = VEHICLES[Number(data.preset)];
  }
  const thresholds = { small: [10, 20], medium: [15, 30], large: [30, 60] }[preset.size];
  const actor = await foundry.documents.Actor.create({ name: preset.name, type: "vehicle", img: preset.img, ownership: { default: 0, [game.user.id]: 3 }, system: {
    biography: `${preset.description}\nИсточник: Zaibatsu — rus, с. ${preset.page}.`,
    vehicle: { size: preset.size, mode: preset.name.startsWith("Грав") ? "grav" : "ground", armor: preset.armor, damage: 0, disabledAt: thresholds[0], destroyedAt: thresholds[1], speed: 0, driver: "", passengers: [] } } });
  await actor.sheet.render({ force: true });
  return actor;
}
export async function createNPC() {
  if (!game.user.isGM) throw new Error("NPC создаёт ведущий.");
  const data = await prompt("NPC / андроид", [
    { name: "name", label: "Имя", value: "Охранник" },
    { name: "preset", label: "Шаблон", value: "guard", options: options([["guard", "Охранник"], ["thug", "Уличный боец"], ["hacker", "Корпоративный хакер"], ["android70", "Андроид: серия 70"], ["android90", "Андроид: серия 90"], ["android110", "Андроид: серия 110"]]) }
  ]);
  if (!data) return;
  if (!data.name.trim()) throw new Error("Укажите имя.");
  const android = data.preset.startsWith("android");
  const level = android ? { android70: 1, android90: 2, android110: 3 }[data.preset] : 0;
  const values = android ? [5 + level * 2, 3 + level * 2, 7, 5 + level, 9 + level, 0] : [7, 7, 7, 7, 7, 7];
  const skills = Object.fromEntries(Object.entries(SKILLS).map(([key, skill]) => [key, skill.basic ? 0 : null]));
  if (data.preset === "hacker" || android) skills.computers = android ? 3 : 2;
  if (data.preset === "thug") { skills.bujutsu = 2; skills.streetwise = 1; }
  if (data.preset === "guard" || android) { skills.shooting = 1; skills.recon = 1; }
  const ids = data.preset === "hacker" ? ["deck3", "icebreaker3", "icebreaker5", "autopistol"] : ["autopistol", "ballisticArmor"];
  const past = await background();
  const actor = await foundry.documents.Actor.create({ name: data.name.trim(), type: android ? "android" : "npc",
    items: ids.map(id => { const item = CATALOG.find(item => item.id === id); return { name: item.name, type: item.type, img: item.img, system: { ...clone(item.system), equipped: true } }; }),
    system: { attributes: Object.fromEntries(Object.keys(ATTRIBUTES).map((key, i) => [key, { value: values[i], max: values[i] }])), skills,
      biography: `${past.text}\nИгровой шаблон; параметры можно изменить.`, contacts: past.contacts, created: true } });
  await actor.sheet.render({ force: true });
}
export async function advancement(actor) {
  guard(actor);
  const data = await prompt("Продвижение", [
    { name: "points", label: "Изменение ОП", type: "number", value: 0 },
    { name: "skill", label: "Навык для полученных уровней", value: "shooting", options: options(Object.entries(SKILLS).map(([key, skill]) => [key, skill.label])) }
  ]);
  if (!data) return;
  if (!game.user.isGM) throw new Error("ОП за миссии назначает ведущий.");
  const experience = Math.max(0, actor.system.experience + data.points);
  const next = RANKS.filter(rank => rank.points <= experience).at(-1);
  const gained = RANKS.filter(rank => rank.rank > actor.system.rank && rank.rank <= next.rank);
  const update = { "system.experience": experience };
  if (gained.length) {
    update["system.rank"] = next.rank;
    update["system.money"] = actor.system.money + gained.reduce((sum, rank) => sum + rank.money, 0);
    const levels = gained.reduce((sum, rank) => sum + rank.skill, 0);
    if (levels) update[`system.skills.${data.skill}`] = Math.max(0, actor.system.skills[data.skill] ?? -1) + levels;
    update["system.advancement.retroPoints"] = (actor.system.advancement.retroPoints ?? 0) + gained.length * 5;
    if (gained.some(rank => rank.rank === 4) && actor.system.skills.gravVehicles === null) update["system.skills.gravVehicles"] = 0;
  }
  await actor.update(update);
  await chat(actor, "Продвижение", escape(`ОП ${experience}. Ранг ${actor.system.rank}: ${RANKS.find(rank => rank.rank === actor.system.rank)?.name ?? ""}. Свободные очки ретрогеники ${actor.system.advancement.retroPoints ?? 0}.`));
}
export async function addAdaptation(actor, id) {
  guard(actor);
  const entry = CATALOG.find(item => item.id === id && item.type === "retrogenic");
  if (!entry) throw new Error("Ретрогеника не найдена.");
  if (actor.items.some(item => item.type === "retrogenic" && item.system.effectKey === id)) throw new Error("Эта адаптация уже установлена.");
  const available = actor.system.advancement.retroPoints ?? 0;
  if (available < entry.system.points) throw new Error("Недостаточно очков ретрогеники.");
  await importCatalog(actor, id);
  await actor.update({ "system.advancement.retroPoints": available - entry.system.points });
}
