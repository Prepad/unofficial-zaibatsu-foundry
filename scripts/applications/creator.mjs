import { ATTRIBUTES, SKILLS } from "../config.mjs";
import { CATALOG, CONCEPTS } from "../data/catalog.mjs";
import { EVENTS, CONTACTS, APPEARANCE, MOTIVATION, TRAITS, ENMITY } from "../data/background.mjs";
import { buildCharacter, additionalSkills } from "../rules/creation.mjs";
import { escape, notifyAction, prompt } from "../services/runtime.mjs";

const roll = async formula => (await new foundry.dice.Roll(formula).evaluate()).total;
const table66 = async table => table[(await roll("1d6") - 1) * 6 + await roll("1d6") - 1];
export async function background() {
  const event = await table66(EVENTS);
  const cause = event.startsWith("Враг:") ? ` (${ENMITY[await roll("1d6") - 1]})` : "";
  const contacts = [{ name: await table66(CONTACTS), notes: "Контакт из прошлого", loyalty: 0 }];
  return { contacts, text: `${event}${cause}\nВнешность: ${APPEARANCE[await roll("2d6") - 2]}\nПримета: ${TRAITS[await roll("3d6") - 3]}\nМотивация: ${MOTIVATION[await roll("2d6") - 2]}` };
}
export class CharacterCreator extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  static DEFAULT_OPTIONS = { classes: ["zaibatsu"], position: { width: 820, height: 760 }, window: { title: "Zaibatsu · Создание персонажа", resizable: true },
    actions: { generate: CharacterCreator.generate, save: CharacterCreator.save, randomConcept: CharacterCreator.randomConcept }, tag: "form", form: { closeOnSubmit: false, handler: CharacterCreator.save } };
  static PARTS = { main: { template: "systems/zaibatsu/templates/applications/creator.hbs", scrollable: [".zb-creator-content"] } };
  rolls = [];
  age = 24;
  generatedBackground = null;
  async _prepareContext() {
    return { rolls: this.rolls.map((value, index) => ({ value, index })), age: this.age, hasRolls: this.rolls.length === 6,
      concepts: CONCEPTS, attributes: Object.entries(ATTRIBUTES).map(([key, label], index) => ({ key, label: game.i18n.localize(label), rolls: this.rolls.map((value, i) => ({ value, index: i, selected: i === index })) })),
      skills: Object.entries(SKILLS).map(([key, entry]) => ({ key, ...entry })),
      adaptations: CATALOG.filter(item => item.type === "retrogenic"), biography: this.generatedBackground?.text ?? "" };
  }
  _onRender(context, options) {
    super._onRender(context, options);
    this.element.addEventListener("change", () => this.updateHints());
    this.updateHints();
  }
  updateHints() {
    const form = this.element;
    const concept = CONCEPTS.find(c => c.id === form.querySelector('[name="concept"]')?.value);
    const skillSelect = form.querySelector('[name="skill"]');
    if (concept && !concept.skills.includes(skillSelect.value)) skillSelect.innerHTML = concept.skills.map(key => `<option value="${key}">${escape(SKILLS[key].label)}</option>`).join("");
    const index = Number(form.querySelector('[name="education"]')?.value);
    const count = this.rolls.length ? additionalSkills(this.rolls[index], game.settings.get("zaibatsu", "educationRule")) : 0;
    const spent = [...form.querySelectorAll('[name="adaptation"]:checked')].reduce((sum, input) => sum + CATALOG.find(item => item.id === input.value).system.points, 0);
    const selected = form.querySelectorAll('[name="extraSkill"]:checked').length;
    form.querySelector(".zb-creator-hints").textContent = `Дополнительные навыки: ${selected}/${count}. Ретрогеника: ${spent}/20. Концепция: ${concept?.name ?? ""}.`;
    const kit = form.querySelector(".zb-concept-kit");
    if (concept) kit.textContent = `Экипировка концепции: ${concept.items.map(id => CATALOG.find(item => item.id === id).name).join(", ") || "нет"}. Основная характеристика: ${game.i18n.localize(ATTRIBUTES[concept.attribute])}.`;
  }
  static async generate() {
    return notifyAction(async () => {
      this.rolls = [];
      for (let i = 0; i < 6; i++) this.rolls.push(await roll("2d6"));
      this.age = await roll("2d6") + 17;
      this.generatedBackground = await background();
      await this.render({ force: true });
    });
  }
  static async randomConcept() {
    const value = await roll("3d6");
    this.element.querySelector('[name="concept"]').value = CONCEPTS.find(c => c.roll === value).id;
    this.updateHints();
  }
  static async save() {
    if (this.saving) return;
    return notifyAction(async () => {
      if (this.rolls.length !== 6) throw new Error("Сначала бросьте характеристики.");
      const form = this.element;
      const value = name => form.querySelector(`[name="${name}"]`).value;
      const data = buildCharacter({ name: value("name"), concept: value("concept"), rolls: this.rolls,
        assignments: Object.fromEntries(Object.keys(ATTRIBUTES).map(key => [key, Number(value(key))])),
        skill: value("skill"), extraSkills: [...form.querySelectorAll('[name="extraSkill"]:checked')].map(input => input.value),
        adaptations: [...form.querySelectorAll('[name="adaptation"]:checked')].map(input => input.value),
        catalog: CATALOG, concepts: CONCEPTS, age: Number(value("age")), biography: value("biography"), educationRule: game.settings.get("zaibatsu", "educationRule") });
      data.system.contacts = this.generatedBackground?.contacts ?? [{ name: "Контакт", notes: "Укажите знакомого", loyalty: 0 }];
      data.ownership = { default: 0, [game.user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER };
      const concept = CONCEPTS.find(c => c.id === value("concept"));
      if (concept.id === "commando") {
        const kit = await prompt("Вооружение спецназовца", [{ name: "kit", label: "Комплект", value: "rocket", options: [{ value: "rocket", label: "Два БРМД" }, { value: "magneticMine", label: "Четыре магнитные мины" }] }]);
        if (!kit) return;
        if (kit.kit === "magneticMine") {
          data.items = data.items.filter(item => item.system.catalogId !== "rocket");
          for (let i = 0; i < 4; i++) { const item = CATALOG.find(item => item.id === "magneticMine"); data.items.push({ name: item.name, type: item.type, img: item.img, system: structuredClone(item.system) }); }
        }
      }
      if (concept.id === "gangster") {
        const choices = CATALOG.filter(item => item.type === "weapon" && item.system.kind === "melee").map(item => ({ value: item.id, label: item.name }));
        const kit = await prompt("Два оружия ближнего боя", [{ name: "one", label: "Первое", value: "katana", options: choices }, { name: "two", label: "Второе", value: "tanto", options: choices }]);
        if (!kit) return;
        data.items = data.items.filter(item => !["katana", "tanto"].includes(item.system.catalogId));
        for (const id of [kit.one, kit.two]) { const item = CATALOG.find(item => item.id === id); data.items.push({ name: item.name, type: item.type, img: item.img, system: structuredClone(item.system) }); }
      }
      this.saving = true;
      let actor;
      let vehicle;
      try {
        actor = await foundry.documents.Actor.create(data);
        if (concept.id === "driver") {
          vehicle = await foundry.documents.Actor.create({ name: `${actor.name} — бронированный седан`, type: "vehicle", img: "systems/zaibatsu/assets/items/armoredSedan.png", ownership: data.ownership,
            system: { vehicle: { size: "medium", mode: "ground", armor: 12, damage: 0, disabledAt: 15, destroyedAt: 30, speed: 0, driver: actor.uuid, passengers: [] } } });
          const gear = actor.items.find(item => item.system.catalogId === "armoredSedan");
          await gear.update({ "system.linkedActorUuid": vehicle.uuid });
        }
      } catch (error) {
        if (vehicle) await vehicle.delete();
        if (actor) await actor.delete();
        throw error;
      } finally { this.saving = false; }
      await actor.sheet.render({ force: true });
      await this.close();
    });
  }
}
