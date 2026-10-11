import { ATTRIBUTES, SKILLS, SKILL_GROUPS, ITEM_TYPES } from "../config.mjs";
import { Workbench } from "../applications/workbench.mjs";
import { unarmed, healDialog } from "../services/combat.mjs";
import { cardLabel } from "../rules/cyberspace.mjs";
import { executeActorCommand } from "../services/actor-actions.mjs";
import { ITEM_ACTIONS, inventoryContext, itemActions, performItemAction } from "../services/item-actions.mjs";
import { applyConcept } from "../services/concepts.mjs";
import { notifyAction, serial } from "../services/runtime.mjs";

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
      clearCondition: ZaibatsuActorSheet.clearCondition,
      itemAction: ZaibatsuActorSheet.itemAction,
      command: ZaibatsuActorSheet.command
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
        { id: "cyber", label: "Киберпространство" },
        { id: "biography", label: "ZAIBATSU.Tabs.Biography" }
      ]
    }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.actor.system;
    const inventory = inventoryContext(this.actor, this.isEditable).map(item => ({ ...item,
      typeLabel: game.i18n.localize(ITEM_TYPES[item.type]) }));
    const cyber = system.cyber ?? {};
    return {
      ...context, actor: this.actor, system, editable: this.isEditable, gm: game.user.isGM,
      vehicle: system.vehicle, conditions: system.conditions, penalty: this.actor.penalty,
      woundLabel: this.actor.stateLabel,
      favorites: inventory.filter(item => item.favorite),
      cyber: { ...cyber, revealed: (cyber.revealed ?? []).map(entry => ({ node: entry.node, label: cardLabel(entry.card) })) },
      cyberItems: inventory.filter(item => ["cyberdeck", "program"].includes(item.type)),
      retroPoints: system.advancement.retroPoints ?? 0,
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
      inventory
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
  async _onRender(context, options) {
    await super._onRender(context, options);
    game.zaibatsu.windows.add(this);
    const container = this.element.querySelector(".zb-sheet");
    this._createContextMenu(this._getItemContextOptions, ".zb-item-row[data-item-id]", { container, fixed: true });
    this._createContextMenu(this._getItemContextOptions, ".zb-item-menu", { container, eventName: "click", fixed: true, relative: "target" });
  }
  _onClose(options) { game.zaibatsu.windows.delete(this); return super._onClose(options); }
  _getItemContextOptions() {
    const itemFor = target => this.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    return ITEM_ACTIONS.map(action => ({ label: action.label, icon: action.icon,
      visible: target => {
        const item = itemFor(target);
        return !!item && itemActions(this.actor, item, this.isEditable).some(entry => entry.id === action.id);
      },
      onClick: (_event, target) => this._performItemAction(itemFor(target), action.id)
    }));
  }
  async _performItemAction(item, action) {
    if (this.busy) return;
    this.busy = true;
    try {
      return await notifyAction(async () => {
        if (this.isEditable) await this.submit();
        return performItemAction(this.actor, item, action, this.isEditable);
      });
    } finally { this.busy = false; if (this.rendered) await this.render(); }
  }
  static itemAction(_event, target) { return this._performItemAction(this.actor.items.get(target.dataset.itemId), target.dataset.itemAction); }
  static async command(_event, target) {
    if (!this.isEditable || this.busy) return;
    this.busy = true;
    try { return await notifyAction(async () => { await this.submit(); return executeActorCommand(this.actor, target.dataset.command, target.dataset); }); }
    finally { this.busy = false; if (this.rendered) await this.render(); }
  }
  _onDrop(event) {
    if (!this.isEditable) return null;
    // Core must read DataTransfer during the native drop event, before Chrome
    // protects it. Queue document mutations only after the data is resolved.
    return notifyAction(() => super._onDrop(event));
  }
  _onDropDocument(event, document) {
    if (!this.isEditable) return null;
    return serial(`sheet-drop:${this.actor.uuid}`, () => {
      if (["JournalEntry", "JournalEntryPage"].includes(document.documentName)) return applyConcept(this.actor, document);
      return super._onDropDocument(event, document);
    });
  }
  async _onDropItem(event, item) {
    if (!this.isEditable) return null;
    const favorite = !!event.target.closest('[data-drop-zone="favorites"]');
    if (item.parent?.uuid === this.actor.uuid && favorite) return item.update({ "system.favorite": true });
    if (item.parent?.uuid === this.actor.uuid) return super._onDropItem(event, item);
    if (!Object.hasOwn(ITEM_TYPES, item.type)) throw new Error("Этот тип предмета не поддерживается системой Zaibatsu.");
    const data = item.inCompendium ? game.items.fromCompendium(item, { clearFolder: true }) : item.toObject();
    delete data._id;
    delete data.folder;
    data.system.favorite = favorite;
    const [created] = await this.actor.createEmbeddedDocuments("Item", [data]);
    return created;
  }
  async _onDropActor(event, actor) {
    if (!this.isEditable) return null;
    if (this.actor.type === "vehicle" && actor.system.skills) {
      if (event.target.closest('[data-drop-zone="passengers"]')) {
        return this.actor.update({ "system.vehicle.passengers": [...new Set([...this.actor.system.vehicle.passengers, actor.uuid])] });
      }
      return this.actor.update({ "system.vehicle.driver": actor.uuid });
    }
    if (this.actor.type === "vehicle" || actor.type !== "vehicle") throw new Error("В лист агента можно перетащить транспорт; в лист транспорта — водителя или пассажира.");
    const favorite = !!event.target.closest('[data-drop-zone="favorites"]');
    if (actor.inCompendium) {
      const existing = this.actor.items.find(item => item.getFlag("zaibatsu", "vehicleSource") === actor.uuid);
      if (existing && await fromUuid(existing.system.linkedActorUuid)) {
        if (favorite) await existing.update({ "system.favorite": true });
        return existing;
      }
      if (!game.user.isGM && !game.user.can("ACTOR_CREATE")) throw new Error("Для импорта транспорта нужны права на создание акторов. Ведущий может импортировать его в мир, после чего перетащите транспорт из каталога акторов.");
      const data = game.actors.fromCompendium(actor, { clearFolder: true });
      delete data._id;
      data.ownership = { default: 0, [game.user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER };
      const created = await foundry.documents.Actor.create(data);
      try { return await this._linkVehicle(created, favorite, actor.uuid); }
      catch (error) { await created.delete(); throw error; }
    }
    return this._linkVehicle(actor, favorite);
  }
  async _linkVehicle(vehicle, favorite, sourceUuid = "") {
    const existing = this.actor.items.find(item => item.system.linkedActorUuid === vehicle.uuid
      || (sourceUuid && item.getFlag("zaibatsu", "vehicleSource") === sourceUuid));
    if (existing) {
      await existing.update({ "system.linkedActorUuid": vehicle.uuid, "system.favorite": favorite || !!existing.system.favorite });
      return existing;
    }
    const [item] = await this.actor.createEmbeddedDocuments("Item", [{ name: vehicle.name, type: "gear", img: vehicle.img,
      flags: { zaibatsu: { vehicleSource: sourceUuid } },
      system: { linkedActorUuid: vehicle.uuid, description: vehicle.system.biography, slots: 0, quantity: 1, favorite } }]);
    return item;
  }
  async _onDropFolder(event, folder) {
    if (!this.isEditable) return null;
    if (folder.type !== "Item") throw new Error("В инвентарь можно перетащить папку предметов.");
    for (const item of folder.contents) await this._onDropItem(event, item);
    for (const child of folder.children ?? []) await this._onDropFolder(event, child.folder);
    return folder;
  }
  _onDragStart(event) {
    const row = event.target.closest("[data-item-id]");
    const item = this.actor.items.get(row?.dataset.itemId);
    if (!item) return super._onDragStart(event);
    event.dataTransfer.setData("text/plain", JSON.stringify(item.toDragData()));
  }
}

export class VehicleSheet extends ZaibatsuActorSheet {
  static DEFAULT_OPTIONS = { classes: ["zb-vehicle-sheet"] };
  static TABS = {};
  static PARTS = { main: { template: "systems/zaibatsu/templates/actors/vehicle.hbs" } };
  async _prepareContext(options) {
    const context = await foundry.applications.sheets.ActorSheetV2.prototype._prepareContext.call(this, options);
    const inventory = inventoryContext(this.actor, this.isEditable).map(item => ({ ...item, typeLabel: game.i18n.localize(ITEM_TYPES[item.type]) }));
    return { ...context, actor: this.actor, system: this.actor.system, editable: this.isEditable, inventory, stateLabel: this.actor.stateLabel,
      passengers: await Promise.all(this.actor.system.vehicle.passengers.map(async uuid => ({ uuid, name: (await fromUuid(uuid))?.name ?? "Недоступный пассажир" }))),
      sizes: ["small", "medium", "large"].map(value => ({ value, label: { small: "Малый", medium: "Средний", large: "Большой" }[value], selected: this.actor.system.vehicle.size === value })),
      modes: [["ground", "Наземный транспорт"], ["grav", "Гравитранспорт"]].map(([value, label]) => ({ value, label, selected: this.actor.system.vehicle.mode === value })),
      drivers: [{ uuid: "", name: "Без водителя" }, ...game.actors.filter(actor => actor.system.skills).map(actor => ({ uuid: actor.uuid, name: actor.name, selected: this.actor.system.vehicle.driver === actor.uuid }))] };
  }
}
