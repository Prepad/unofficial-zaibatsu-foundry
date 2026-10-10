import { ATTRIBUTES, SKILLS, SKILL_GROUPS, ITEM_TYPES, WOUND_NAMES } from "../config.mjs";
import { Workbench } from "../applications/workbench.mjs";
import { unarmed, healDialog } from "../services/combat.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;

export class ZaibatsuActorSheet extends HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["zaibatsu", "zb-actor-sheet"],
    tag: "form",
    position: { width: 760, height: 720 },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      rollCharacteristic: ZaibatsuActorSheet.rollCharacteristic,
      rollSkill: ZaibatsuActorSheet.rollSkill,
      createItem: ZaibatsuActorSheet.createItem,
      editItem: ZaibatsuActorSheet.editItem,
      deleteItem: ZaibatsuActorSheet.deleteItem,
      terminal: ZaibatsuActorSheet.terminal,
      attack: ZaibatsuActorSheet.attack,
      equip: ZaibatsuActorSheet.equip,
      reload: ZaibatsuActorSheet.reload,
      aim: ZaibatsuActorSheet.aim,
      unarmed: ZaibatsuActorSheet.unarmed,
      aid: ZaibatsuActorSheet.aid,
      clearCondition: ZaibatsuActorSheet.clearCondition
    }
  };

  static PARTS = {
    main: { template: "systems/zaibatsu/templates/actors/agent.hbs", scrollable: [".zb-tab-body"] }
  };

  static TABS = {
    primary: {
      initial: "overview",
      tabs: [
        { id: "overview", label: "ZAIBATSU.Tabs.Overview" },
        { id: "skills", label: "ZAIBATSU.Tabs.Skills" },
        { id: "inventory", label: "ZAIBATSU.Tabs.Inventory" },
        { id: "biography", label: "ZAIBATSU.Tabs.Biography" }
      ]
    }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.actor.system;
    return {
      ...context, actor: this.actor, system, editable: this.isEditable,
      vehicle: system.vehicle, conditions: system.conditions, penalty: this.actor.penalty,
      woundLabel: WOUND_NAMES[system.wounds.severity],
      slots: this.actor.items.reduce((sum, item) => sum + item.system.slots * item.system.quantity, 0),
      tabs: this._prepareTabs("primary"),
      attributes: Object.entries(ATTRIBUTES).map(([key, label]) => ({
        key, label: game.i18n.localize(label), ...system.attributes[key],
        modifier: system.modifiers[key]
      })),
      skillGroups: Object.entries(SKILL_GROUPS).map(([group, label]) => ({
        label: game.i18n.localize(label),
        skills: Object.entries(SKILLS).filter(([, skill]) => skill.group === group)
          .map(([key, skill]) => ({ key, label: skill.label, level: system.skills[key],
            untrained: system.skills[key] === null }))
      })),
      inventory: this.actor.items.map(item => ({
        id: item.id, name: item.name, img: item.img, typeLabel: game.i18n.localize(ITEM_TYPES[item.type]),
        quantity: item.system.quantity, equipped: item.system.equipped, uuid: item.uuid,
        isWeapon: item.type === "weapon", damage: item.system.damage,
        ammo: item.system.ammunition, capacity: item.system.capacity,
        ranged: item.type === "weapon" && item.system.kind !== "melee"
      }))
    };
  }

  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    for (const key of Object.keys(SKILLS)) {
      const input = form.elements.namedItem(`system.skills.${key}`);
      if (input && data.system?.skills && Object.hasOwn(data.system.skills, key)) {
        data.system.skills[key] = input.value.trim() === "" ? null : Number(input.value);
      }
    }
    return data;
  }

  static async run(action) {
    try { return await action(); }
    catch (error) {
      console.error("Zaibatsu | Sheet action failed", error);
      ui.notifications.error(error.message);
    }
  }

  static async rollCharacteristic(_event, target) {
    return ZaibatsuActorSheet.run(async () => {
      if (!this.isEditable) return;
      await this.submit();
      return this.actor.rollCharacteristic(target.dataset.attribute);
    });
  }

  static async rollSkill(_event, target) {
    return ZaibatsuActorSheet.run(async () => {
      if (!this.isEditable) return;
      await this.submit();
      return this.actor.rollSkill(target.dataset.skill);
    });
  }

  static async createItem() {
    return ZaibatsuActorSheet.run(async () => {
      if (!this.isEditable) return;
      const content = await foundry.applications.handlebars.renderTemplate(
        "systems/zaibatsu/templates/applications/create-item.hbs", {
          types: Object.entries(ITEM_TYPES).map(([value, label]) => ({ value, label: game.i18n.localize(label) }))
        }
      );
      const data = await foundry.applications.api.DialogV2.prompt({
        window: { title: game.i18n.localize("ZAIBATSU.Inventory.Add") },
        content, rejectClose: false,
        ok: {
          label: game.i18n.localize("ZAIBATSU.Inventory.Add"),
          callback: (_event, button) => {
            const name = button.form.elements.namedItem("name").value.trim();
            const type = button.form.elements.namedItem("type").value;
            if (!name) throw new Error(game.i18n.localize("ZAIBATSU.Errors.NameRequired"));
            if (!Object.hasOwn(ITEM_TYPES, type)) throw new Error("Unknown item type");
            return { name, type };
          }
        }
      });
      if (!data) return;
      const [item] = await this.actor.createEmbeddedDocuments("Item", [data]);
      await item.sheet.render({ force: true });
    });
  }

  static async editItem(_event, target) {
    const item = this.actor.items.get(target.dataset.itemId);
    if (item) return item.sheet.render({ force: true });
  }

  static async deleteItem(_event, target) {
    if (!this.isEditable) return;
    const item = this.actor.items.get(target.dataset.itemId);
    if (item) return item.deleteDialog();
  }
  static terminal() { return new Workbench(this.actor).render({ force: true }); }
  static attack(_event, target) { return this.constructor.run(() => this.actor.items.get(target.dataset.itemId)?.roll()); }
  static reload(_event, target) { return this.constructor.run(() => this.actor.reload(target.dataset.itemId)); }
  static aim(_event, target) { return this.constructor.run(() => this.actor.aim(target.dataset.itemId)); }
  static unarmed() { return this.constructor.run(() => unarmed(this.actor)); }
  static aid() { return this.constructor.run(() => healDialog(this.actor)); }
  static clearCondition(_event, target) { return this.constructor.run(() => this.actor.clearCondition(target.dataset.id)); }
  static equip(_event, target) { return this.constructor.run(async () => {
    if (!this.isEditable) return;
    const item = this.actor.items.get(target.dataset.itemId);
    return item.update({ "system.equipped": !item.system.equipped });
  }); }
  async _onDropItem(event, item) {
    if (!this.isEditable) return null;
    if (item.parent?.uuid === this.actor.uuid) return super._onDropItem(event, item);
    const data = item.toObject();
    delete data._id;
    const [created] = await this.actor.createEmbeddedDocuments("Item", [data]);
    return created;
  }
  _onDragStart(event) {
    const row = event.target.closest("[data-item-id]");
    const item = this.actor.items.get(row?.dataset.itemId);
    if (!item) return super._onDragStart(event);
    event.dataTransfer.setData("text/plain", JSON.stringify(item.toDragData()));
  }
}

export class VehicleSheet extends ZaibatsuActorSheet {
  static PARTS = { main: { template: "systems/zaibatsu/templates/actors/vehicle.hbs" } };
  async _prepareContext(options) {
    const context = await foundry.applications.sheets.ActorSheetV2.prototype._prepareContext.call(this, options);
    return { ...context, actor: this.actor, system: this.actor.system, editable: this.isEditable,
      sizes: ["small", "medium", "large"].map(value => ({ value, label: { small: "Малый", medium: "Средний", large: "Большой" }[value], selected: this.actor.system.vehicle.size === value })),
      modes: [["ground", "Наземный транспорт"], ["grav", "Гравитранспорт"]].map(([value, label]) => ({ value, label, selected: this.actor.system.vehicle.mode === value })),
      drivers: [{ uuid: "", name: "Без водителя" }, ...game.actors.filter(actor => actor.system.skills).map(actor => ({ uuid: actor.uuid, name: actor.name, selected: this.actor.system.vehicle.driver === actor.uuid }))] };
  }
}
