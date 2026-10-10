export const ATTRIBUTES = {
  strength: "ZAIBATSU.Attributes.Strength",
  dexterity: "ZAIBATSU.Attributes.Dexterity",
  endurance: "ZAIBATSU.Attributes.Endurance",
  intelligence: "ZAIBATSU.Attributes.Intelligence",
  education: "ZAIBATSU.Attributes.Education",
  social: "ZAIBATSU.Attributes.Social"
};

export const SKILL_GROUPS = {
  combat: "ZAIBATSU.SkillGroups.Combat",
  social: "ZAIBATSU.SkillGroups.Social",
  technical: "ZAIBATSU.SkillGroups.Technical",
  street: "ZAIBATSU.SkillGroups.Street"
};

export const SKILLS = {
  bujutsu: { label: "Будзюцу", group: "combat", basic: true },
  explosives: { label: "Взрывчатка", group: "combat" },
  jujutsu: { label: "Джиу-джитсу", group: "combat", basic: true },
  karate: { label: "Карате", group: "combat", basic: true },
  aiming: { label: "Прицеливание", group: "combat" },
  shooting: { label: "Стрельба", group: "combat", basic: true },
  heavyWeapons: { label: "Тяжёлое оружие", group: "combat" },
  gambling: { label: "Азартные игры", group: "social" },
  administration: { label: "Бюрократия", group: "social" },
  bribery: { label: "Взятки", group: "social" },
  commerce: { label: "Коммерция", group: "social" },
  carousing: { label: "Кутёж", group: "social" },
  leadership: { label: "Лидерство", group: "social" },
  forgery: { label: "Подделка", group: "social" },
  medicine: { label: "Медицина", group: "technical" },
  mechanics: { label: "Механика", group: "technical" },
  communications: { label: "Коммуникаторы", group: "technical" },
  computers: { label: "Компьютеры", group: "technical" },
  security: { label: "Системы безопасности", group: "technical" },
  electronics: { label: "Электроника", group: "technical" },
  urbanSurvival: { label: "Городское выживание", group: "street" },
  gravVehicles: { label: "Гравитранспорт", group: "street" },
  streetwise: { label: "Знание улиц", group: "street" },
  groundVehicles: { label: "Наземный транспорт", group: "street", basic: true },
  recon: { label: "Разведка", group: "street" },
  investigation: { label: "Расследование", group: "street" }
};

export const ITEM_TYPES = {
  weapon: "ZAIBATSU.ItemTypes.Weapon",
  armor: "ZAIBATSU.ItemTypes.Armor",
  gear: "ZAIBATSU.ItemTypes.Gear",
  retrogenic: "ZAIBATSU.ItemTypes.Retrogenic",
  cyberdeck: "ZAIBATSU.ItemTypes.Cyberdeck",
  program: "ZAIBATSU.ItemTypes.Program"
};
export const WOUND_NAMES = { healthy: "Здоров", minor: "Незначительные повреждения", wounded: "Ранен", serious: "Серьёзно ранен", dead: "Мёртв" };
