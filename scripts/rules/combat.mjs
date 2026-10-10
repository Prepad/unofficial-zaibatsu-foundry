import { skillModifier, characteristicModifier } from "./checks.mjs";

export const PHYSICAL = ["endurance", "strength", "dexterity"];
export const PHASES = ["declaration", "melee", "ranged", "aftermath"];

export function woundState(attributes) {
  const zeros = PHYSICAL.filter(key => attributes[key].value <= 0).length;
  return zeros === 3 ? "dead" : zeros >= 2 ? "serious" : zeros === 1 ? "wounded" : "healthy";
}

export function distributeDamage(attributes, amount, { armor = 0, penetration = 0, first = "strength" } = {}) {
  if (!Number.isInteger(amount) || amount < 0) throw new RangeError("Damage must be a non-negative integer");
  if (!["strength", "dexterity"].includes(first)) throw new RangeError("Choose strength or dexterity");
  const absorbed = Math.min(amount, Math.max(0, armor - penetration));
  let remaining = amount - absorbed;
  const values = Object.fromEntries(PHYSICAL.map(key => [key, attributes[key].value]));
  for (const key of ["endurance", first, first === "strength" ? "dexterity" : "strength"]) {
    const loss = Math.min(values[key], remaining);
    values[key] -= loss;
    remaining -= loss;
  }
  const state = woundState(Object.fromEntries(PHYSICAL.map(key => [key, { value: values[key] }])));
  return { values, absorbed, inflicted: amount - absorbed, overflow: remaining, state };
}

export function healAttributes(attributes, amount, order = PHYSICAL) {
  if (!Number.isInteger(amount) || amount < 0) throw new RangeError("Healing must be a non-negative integer");
  const values = Object.fromEntries(PHYSICAL.map(key => [key, attributes[key].value]));
  let remaining = amount;
  for (const key of order) {
    const healed = Math.min(Math.max(0, attributes[key].max - values[key]), remaining);
    values[key] += healed;
    remaining -= healed;
  }
  return { values, healed: amount - remaining };
}

export function rangedModifier(distance, effective, kind = "ranged") {
  if (!Number.isFinite(distance) || distance < 0) throw new RangeError("Invalid distance");
  if (kind === "melee") {
    if (distance > 3) throw new RangeError("Цель дальше 3 метров: ближний бой невозможен.");
    return 0;
  }
  if (kind === "thrown") {
    if (distance > 40) throw new RangeError("Метание дальше 40 метров невозможно.");
    return distance > 10 ? -2 : 0;
  }
  if (effective <= 0 || distance > effective * 8) throw new RangeError("Цель вне предельной дистанции оружия.");
  return distance > effective * 4 ? -4 : distance > effective ? -2 : 0;
}

export function attackPlan({ weapon, actor, target, distance = 1, mode = "single", cover = false,
  ownCover = false, dodge = false, darkness = 0, smoke = 0, blind = false, offhand = false,
  adjacent = false, aim = 0, situational = 0, defense = null, strong = false }) {
  const parts = [];
  const add = (label, value) => { if (value) parts.push({ label, value }); };
  const kind = weapon.kind ?? "ranged";
  const level = actor.skills[weapon.skill];
  add("Навык", blind ? 0 : skillModifier(level));
  add("Дистанция", rangedModifier(distance, weapon.range, kind));
  add("Ранения и состояния", actor.penalty ?? 0);
  if (kind === "melee") {
    const parry = defense ?? Math.max(0, ...["bujutsu", "karate", "jujutsu"].map(key => target?.skills[key] ?? 0));
    add("Парирование", -parry);
    add("Силовой удар", strong && !actor.superLimbs ? -2 : 0);
  } else {
    add("Близкая дистанция", kind === "ranged" && distance <= 3 ? 2 : 0);
    add("Ловкость при метании", kind === "thrown" ? actor.attributes.dexterity.value >= 9 ? 1 : actor.attributes.dexterity.value <= 5 ? -1 : 0 : 0);
    add("Цель в укрытии / уклоняется", cover ? -2 : dodge ? -1 : 0);
    add("Атакующий в укрытии", ownCover ? -2 : 0);
    add("Освещение", darkness);
    add("Дым", smoke * (weapon.laser ? 2 : 1));
    add("Соседняя цель", adjacent ? -2 : 0);
    add("Прицеливание", aim);
    add("Прицел", aim > 0 ? weapon.sightBonus ?? 0 : 0);
    add("Размер транспорта", target?.vehicle ? 1 : 0);
    add("Дробь", weapon.shotgun && distance <= weapon.range ? 1 : 0);
  }
  add("Неосновная рука", offhand && !actor.ambidextrous ? -3 : 0);
  add("Оружие", weapon.attackBonus ?? 0);
  add("Обстоятельства", situational);
  const attacks = mode === "auto" ? 4 : mode === "burst" ? 2 : 1;
  if (attacks > (weapon.maxAttacks ?? 1)) throw new RangeError("Оружие не поддерживает выбранный режим огня.");
  const ammo = kind === "melee" ? 0 : mode === "auto" ? 20 : mode === "burst" ? 4 : 1;
  let damage = weapon.damage;
  const shotgunThreshold = weapon.shotgunThreshold ?? 10;
  if (weapon.shotgun) damage = distance <= shotgunThreshold ? "4d6" : distance <= shotgunThreshold * 2 ? "2d6" : "1d6";
  if (strong && weapon.damageType === "shock") damage = "1d6 + 2";
  const strengthBonus = kind === "melee" && actor.attributes.strength.value >= 9 ? 1 : 0;
  return { parts, modifier: parts.reduce((sum, part) => sum + part.value, 0), attacks, ammo,
    formula: blind ? "3d6kl2" : "2d6", damage, strengthBonus,
    addEffect: weapon.damageType !== "shock", damageType: weapon.damageType ?? "damage" };
}

export function vehicleDamage(current, damage, armor, disabledAt, destroyedAt, penetration = 0) {
  const inflicted = Math.max(0, damage - Math.max(0, armor - penetration));
  const total = current + inflicted;
  return { total, inflicted, state: total >= destroyedAt ? "destroyed" : total >= disabledAt ? "disabled" : "operational" };
}

export function collisionFormulas(speed, height = 0) {
  const index = Math.max(speed > 110 ? 4 : speed >= 96 ? 3 : speed >= 81 ? 2 : speed >= 66 ? 1 : speed >= 50 ? 0 : -1,
    height > 60 ? 4 : height >= 31 ? 3 : height >= 16 ? 2 : height >= 9 ? 1 : height >= 4 ? 0 : -1);
  if (index < 0) return { crew: "0", vehicle: "0" };
  return { crew: ["2d6+2", "4d6+4", "8d6+8", "10d10+10", "12d12+12"][index],
    vehicle: ["3d6+6", "5d6+6", "6d6+6", "7d6+6", "8d6+6"][index] };
}

export const attributeTestBonus = characteristicModifier;
