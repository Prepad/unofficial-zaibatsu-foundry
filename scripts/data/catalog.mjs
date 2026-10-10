import { enrichCatalog, VEHICLE_DETAILS } from "./compendium-content.mjs";

const entries = [];
function item(id, name, type, system = {}) {
  entries.push({ id, name, type, system: { catalogId: id, quantity: 1, price: 0, slots: 1, equipped: false, description: "", ...system } });
}
function weapon(id, name, damage, range, price, capacity, maxAttacks = 1, extra = {}) {
  item(id, name, "weapon", { damage, range, price, capacity, ammunition: capacity, reserve: 0,
    maxAttacks, skill: "shooting", kind: "ranged", damageType: "damage", ...extra });
}
weapon("revolver", "Револьвер .357", "2d6+2", 10, 5000, 6);
weapon("stunner", "Шокер", "0", 10, 5000, 5, 1, { special: "stunner" });
weapon("autopistol", "Автопистолет 10 мм", "2d6+1", 10, 5000, 16, 2);
weapon("bullpup", "Винтовка булл-пап 6.50 мм", "3d6", 50, 10000, 25, 2);
weapon("laser", "Боевой лазер", "4d6+2", 100, 35000, 10, 1, { laser: true });
weapon("pumpShotgun", "Помповый дробовик", "4d6", 10, 6000, 4, 1, { shotgun: true });
weapon("lightMG", "Ручной пулемёт 8.85 мм", "3d6+3", 100, 23000, 100, 2);
weapon("autoShotgun", "Автоматический дробовик: пчелиный улей", "4d6", 20, 20000, 8, 2, { shotgun: true });
weapon("autoShotgunHE", "Автоматический дробовик: азид", "4d6", 50, 20000, 8, 2);
weapon("autoShotgunTranq", "Автоматический дробовик: транквилизатор", "0", 50, 20000, 8, 2, { special: "tranquilizer" });
weapon("autoShotgunAP", "Автоматический дробовик: вольфрам", "3d6", 50, 20000, 8, 2, { penetration: 5 });
weapon("flamethrower", "Огнемёт", "2d6", 10, 5000, 6, 2, { skill: "heavyWeapons", special: "fire", maximumRange: 40 });
weapon("machinegun", "Пулемёт 6.50 мм", "3d6", 50, 60000, 500, 4, { skill: "heavyWeapons" });
weapon("grenadeLauncher", "Гранатомёт 30 мм: М4", "5d6", 50, 8000, 6, 1, { skill: "heavyWeapons", special: "fragmentation" });
weapon("rocket", "БРМД", "6d6", 100, 20000, 1, 1, { skill: "heavyWeapons", attackBonus: 3, special: "rocket" });
for (const [id, name, damage, price] of [
  ["knife", "Боевой нож", "2d6+1", 800], ["club", "Дубинка", "2d6", 0],
  ["chain", "Боевая цепь", "2d6", 300], ["katana", "Выдвижная катана", "2d6+2", 5000],
  ["nekode", "Нэкодэ", "2d6+1", 5000], ["nunchaku", "Нунчаки", "2d6", 600], ["tanto", "Танто", "2d6+1", 1000]
]) weapon(id, name, damage, 3, price, 0, 1, { kind: "melee", skill: "bujutsu" });
for (const [id, name, special, damage, price] of [
  ["smokeGrenade", "М1 Дымовая граната", "smoke", "0", 150], ["gasGrenade", "М2 Д-газовая граната", "gas", "0", 250],
  ["stunGrenade", "М3 Оглушающая граната", "stun", "0", 300],
  ["fragGrenade", "М4 Осколочная граната", "fragmentation", "5d6", 250],
  ["heGrenade", "М5 Фугасная граната", "heGrenade", "2d6", 300],
  ["airGrenade", "М6 Осколочная воздушная граната", "airburst", "5d6", 300],
  ["magneticMine", "Магнитная мина", "mine", "4d6", 5000]
]) weapon(id, name, damage, 10, price, 1, 1, { kind: "thrown", skill: "explosives", special });
for (const id of ["heGrenade", "airGrenade"]) {
  const entry = entries.find(entry => entry.id === id);
  Object.assign(entry.system, { kind: "ranged", skill: "heavyWeapons", range: 50, description: "Боеприпас для гранатомёта: для атаки нужен гранатомёт в инвентаре. Остаток боеприпасов учитывается количеством предмета." });
}
entries.find(entry => entry.id === "magneticMine").system.maximumRange = 1;
for (const [id, name, protection, price, slots] of [
  ["concealedArmor", "Stern C: скрытый бронежилет", 4, 5000, 1],
  ["ballisticArmor", "Stern B: баллистический жилет", 5, 4500, 2],
  ["plateArmor", "Enforcer: бронепластины", 9, 32500, 3]
]) item(id, name, "armor", { protection, price, slots });
for (const [id, name, price] of [
  ["headset", "Гарнитура", 0], ["fakeID", "Фальшивая ID-карта", 0], ["drugs", "Дизайнерские препараты", 20000],
  ["bug", "Жучок", 0], ["bugReceiver", "Приёмник жучков", 0], ["disguise", "Набор для маскировки", 0],
  ["tools", "Многофункциональный набор инструментов", 0], ["workshop", "Мастерская", 0],
  ["lockDecoder", "Дешифратор карточных замков", 0], ["medkit", "Аптечка первой помощи", 0],
  ["advancedMedkit", "Расширенный медицинский комплект", 0], ["extinguisher", "Огнетушитель", 0]
]) item(id, name, "gear", { price });
Object.assign(entries.find(entry => entry.id === "fakeID").system, { price: 100000, slots: 0, identity: { threshold: 12 } });
item("retrofittedID", "Ретрофицированная ID-карта", "gear", { price: 5000, slots: 0, identity: { threshold: 9 }, description: "Обнаружение подделки при 9+ на 2d6 при каждом использовании." });
for (const [rating, name, price] of [
  [1, "CMD ZX-22", 3000], [2, "IBN Net Space 2", 7000], [3, "Hosaka Goldstar", 20000],
  [4, "Aztec-Sendai Cyberspace 64", 50000], [5, "Shinobi Farscape 5", 80000], [6, "Aztec-Sendai Cyberspace-6", 100000]
]) item(`deck${rating}`, name, "cyberdeck", { rating, price });
for (const rating of [1, 2, 3, 5, 7, 9]) item(`icebreaker${rating}`, `ЛЕДокол / ${rating}`, "program", { rating, icebreaker: true });
item("standardProgram", "Стандартная программа", "program", { rating: 1, icebreaker: false });
const adaptations = [
  ["ambidextrous", "Амбидекстр", 10, "Нет штрафа −3 за неосновную руку."],
  ["amphibian", "Амфибия", 5, "Дыхание и зрение под водой."],
  ["innerEar", "Внутреннее ухо", 5, "Устойчивость; высота падения уменьшается на 3 м."],
  ["secondSkin", "Вторая кожа", 10, "Защита от огня и напалма; восстановление после сна."],
  ["claws", "Выдвижные когти", 10, "Будзюцу, 2d6+1 урона."],
  ["painThreshold", "Высокий болевой порог", 10, "Игнорирование штрафа ранений; экстремальные усилия при травмах: 1d6 урона."],
  ["flexibility", "Гибкость", 5, "+3 к лазанию."], ["insectEyes", "Глаза насекомого", 10, "Наблюдение и огонь в двух направлениях."],
  ["sleepDeprivation", "Деприватор сна", 5, "10 минут медитации заменяют сон."],
  ["slowMetabolism", "Замедлитель метаболизма", 5, "Вдвое медленнее ухудшение состояния; для выхода проверка ВЫН."],
  ["animalEmpathy", "Животная эмпатия", 5, "Автоматический успех в обаянии животных."],
  ["poisonImmunity", "Иммунитет к ядам", 5, "Защита от токсинов, кроме кислот."],
  ["artificialEyes", "Искусственные глаза", 5, "+2 к действиям, требующим зрения."],
  ["catEyes", "Кошачьи глаза", 10, "Ночное зрение при минимальном источнике света."],
  ["macroVision", "Макрозрение", 5, "Телескопическое зрение до 5 км."], ["microVision", "Микрозрение", 5, "Микроскопическое зрение."],
  ["mimicry", "Мимикрия", 10, "Копирование голоса."], ["muscleMatrix", "Мышечная матрица", 15, "+4 к проверкам СИЛ."],
  ["hearing", "Параболический слух", 5, "+2 к действиям, требующим слуха."], ["subdermalArmor", "Подкожная броня", 20, "ПБ 4."],
  ["pouch", "Подкожный мешочек", 5, "Скрытое хранилище."],
  ["regeneration", "Регенерация", 15, "2 ВЫН в час; ухудшение серьёзных ранений раз в 2 часа."],
  ["superLegs", "Супер-ноги", 10, "Удвоенный бег и прыжки; силовой удар без штрафа."],
  ["superArms", "Супер-руки", 10, "Силовой удар без штрафа."], ["transmorph", "Трансморф", 20, "Смена внешности на 1d6+1 часов."],
  ["breathing", "Улучшенная дыхательная система", 10, "Фильтрация газов; задержка дыхания до 10/20 минут."],
  ["accelerator", "Ускоритель метаболизма", 15, "Два действия за раунд в течение 10 минут; час перезарядки; отключается при ранении."],
  ["pheromones", "Чувство феромонов", 5, "Обнаружение людей до 5 м."], ["eideticMemory", "Эйдетическая память", 5, "Зрительная память."],
  ["fangs", "Ядовитые клыки", 10, "Укус 2 шока; яд: ВЫН +2, провал смертелен, успех 2d6 урона."]
];
for (const [id, name, points, description] of adaptations) item(id, name, "retrogenic", { points, effectKey: id, description, slots: 0, equipped: true });
item("armoredSedan", "Бронированный седан", "gear", { description: "Средний транспорт; ПБ 12, отключение 15, уничтожение 30. Создаётся также отдельным транспортом.", slots: 0 });
enrichCatalog(entries);
export const CATALOG = entries;

export const CONCEPTS = [
  { id: "technician", name: "Технарь", skills: ["mechanics", "electronics"], attribute: "education", items: ["tools", "workshop"], roll: 3 },
  { id: "surgeon", name: "Уличный хирург", skills: ["medicine"], attribute: "education", items: ["drugs"], roll: 4 },
  { id: "salaryman", name: "Сарариман", skills: ["commerce"], attribute: "social", items: ["deck1", "standardProgram", "standardProgram"], roll: 5 },
  { id: "driver", name: "Курума", skills: ["groundVehicles"], attribute: "dexterity", items: ["armoredSedan"], roll: 6 },
  { id: "organTrader", name: "Торговец органами", skills: ["urbanSurvival"], attribute: "dexterity", items: ["stunner"], roll: 7 },
  { id: "hacker", name: "Софт-жокей", skills: ["computers"], attribute: "intelligence", items: ["deck3", "icebreaker3", "icebreaker3", "icebreaker5"], roll: 8 },
  { id: "ninja", name: "Ниндзя", skills: ["security"], attribute: "dexterity", items: ["lockDecoder"], roll: 9 },
  { id: "samurai", name: "Самурай", skills: ["recon"], attribute: "endurance", items: ["concealedArmor"], roll: 10 },
  { id: "commando", name: "Спецназовец", skills: ["heavyWeapons", "explosives"], attribute: "endurance", items: ["rocket", "rocket"], roll: 11 },
  { id: "detective", name: "Детектив", skills: ["investigation"], attribute: "education", items: ["bug", "bug", "bug", "bugReceiver"], roll: 12 },
  { id: "dealer", name: "Делец", skills: ["streetwise"], attribute: "intelligence", items: ["drugs"], roll: 13 },
  { id: "gangster", name: "Буракумин", skills: ["bujutsu"], attribute: "strength", items: ["katana", "tanto"], roll: 14 },
  { id: "killer", name: "Киллер", skills: ["aiming"], attribute: "dexterity", items: ["disguise"], roll: 15 },
  { id: "conArtist", name: "Аферист", skills: ["forgery"], attribute: "social", items: ["fakeID"], roll: 16 },
  { id: "cop", name: "Вольный коп", skills: ["bribery"], attribute: "strength", items: ["concealedArmor"], roll: 17 },
  { id: "martialArtist", name: "Мастер единоборств", skills: ["karate", "jujutsu"], attribute: "endurance", items: [], roll: 18 }
];

export const VEHICLES = VEHICLE_DETAILS.map(entry => ({ ...entry, img: `systems/zaibatsu/assets/items/${entry.id}.png` }));
