import { ATTRIBUTES, SKILLS } from "../config.mjs";

export function additionalSkills(education, interpretation = "table") {
  if (education >= 10) return 4;
  if (education >= (interpretation === "summary" ? 6 : 7)) return 3;
  if (education >= 4) return 2;
  return 1;
}

export function buildCharacter({ name, concept, rolls, assignments, skill, extraSkills = [], adaptations = [],
  catalog, concepts, age, biography = "", educationRule = "table" }) {
  if (!name?.trim()) throw new Error("Укажите имя персонажа.");
  const choice = concepts.find(entry => entry.id === concept);
  if (!choice || !choice.skills.includes(skill)) throw new Error("Выберите навык своей концепции.");
  const keys = Object.keys(ATTRIBUTES);
  if (rolls.length !== 6 || keys.some(key => !Number.isInteger(assignments[key]) || assignments[key] < 0 || assignments[key] > 5) || new Set(Object.values(assignments)).size !== 6) throw new Error("Каждый бросок характеристики нужно использовать ровно один раз.");
  if (!Number.isInteger(age) || age < 19 || age > 29) throw new Error("Начальный возраст: 2d6 + 17 (19–29 лет).");
  const attributes = Object.fromEntries(keys.map(key => {
    const value = rolls[assignments[key]];
    if (!Number.isInteger(value) || value < 2 || value > 12) throw new Error("Характеристики должны быть получены шестью бросками 2d6.");
    return [key, { value, max: value }];
  }));
  const allowed = additionalSkills(attributes.education.value, educationRule);
  if (extraSkills.length !== allowed || new Set(extraSkills).size !== extraSkills.length || extraSkills.includes(skill)) {
    throw new Error(`Выберите ${allowed} разных дополнительных навыков, кроме навыка концепции.`);
  }
  for (const key of extraSkills) {
    if (!Object.hasOwn(SKILLS, key)) throw new Error("Неизвестный навык.");
    if (key === "heavyWeapons" && choice.id !== "commando") throw new Error("Тяжёлое оружие доступно только выходцам из армии.");
  }
  const chosen = adaptations.map(id => catalog.find(item => item.id === id && item.type === "retrogenic"));
  if (chosen.some(item => !item) || new Set(adaptations).size !== adaptations.length || chosen.reduce((sum, item) => sum + item.system.points, 0) > 20) {
    throw new Error("Ретрогеника должна стоить не больше 20 очков.");
  }
  const skills = Object.fromEntries(Object.entries(SKILLS).map(([key, entry]) => [key, entry.basic ? 0 : null]));
  for (const key of [skill, ...extraSkills]) skills[key] = 1;
  const itemIds = ["autopistol", "headset", ...choice.items, ...adaptations];
  const items = itemIds.map(id => {
    const item = catalog.find(entry => entry.id === id);
    if (!item) throw new Error(`В справочнике отсутствует ${id}`);
    return { name: item.name, type: item.type, img: item.img, system: structuredClone(item.system) };
  });
  return { name: name.trim(), type: "character", items, system: {
    concept: choice.name, age, rank: 1, money: 4000, attributes, skills, biography, created: true,
    advancement: { retroPoints: 20 - chosen.reduce((sum, item) => sum + item.system.points, 0) }
  } };
}
