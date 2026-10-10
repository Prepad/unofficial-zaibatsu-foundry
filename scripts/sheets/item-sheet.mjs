import { ITEM_TYPES, SKILLS } from "../config.mjs";
import { itemActions, performItemAction } from "../services/item-actions.mjs";
import { notifyAction } from "../services/runtime.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;

export class ZaibatsuItemSheet extends HandlebarsApplicationMixin(foundry.applications.sheets.ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["zaibatsu", "zb-item-sheet"], tag: "form",
    position: { width: 520, height: 620 }, window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: { linkedActor: ZaibatsuItemSheet.linkedActor, itemAction: ZaibatsuItemSheet.itemAction }
  };

  static PARTS = { main: { template: "systems/zaibatsu/templates/items/item.hbs" } };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.document;
    return {
      ...context, item, system: item.system, editable: this.isEditable,
      owned: !!item.actor,
      itemActions: item.actor ? itemActions(item.actor, item, this.isEditable).filter(action => !["open", "delete", "equip", "favorite"].includes(action.id)) : [],
      typeLabel: game.i18n.localize(ITEM_TYPES[item.type]),
      isWeapon: item.type === "weapon", isArmor: item.type === "armor",
      isRetrogenic: item.type === "retrogenic",
      isProgram: item.type === "program",
      kinds: [["melee", "Ближний бой"], ["ranged", "Дальний бой"], ["thrown", "Метание"]].map(([value, label]) => ({ value, label, selected: item.system.kind === value })),
      damageTypes: [["damage", "Ранение"], ["shock", "Шок"]].map(([value, label]) => ({ value, label, selected: item.system.damageType === value })),
      specials: [["", "Обычное оружие"], ["stunner", "Шокер"], ["tranquilizer", "Транквилизатор"], ["fire", "Огнемёт"], ["smoke", "Дым"], ["gas", "Газ"], ["stun", "Оглушающая граната"], ["fragmentation", "Осколочная граната"], ["heGrenade", "Фугасная граната"], ["airburst", "Воздушный разрыв"], ["mine", "Мина"], ["rocket", "Ракета"], ["poison", "Яд"]].map(([value, label]) => ({ value, label, selected: item.system.special === value })),
      hasRating: ["cyberdeck", "program"].includes(item.type),
      skills: Object.entries(SKILLS).map(([value, skill]) => ({ value, label: skill.label,
        selected: item.system.skill === value }))
    };
  }
  async _onRender(context, options) { await super._onRender(context, options); game.zaibatsu.windows.add(this); }
  _onClose(options) { game.zaibatsu.windows.delete(this); return super._onClose(options); }
  static async itemAction(_event, target) {
    if (!this.document.actor || this.busy) return;
    this.busy = true;
    try { return await notifyAction(async () => { if (this.isEditable) await this.submit(); return performItemAction(this.document.actor, this.document, target.dataset.itemAction, this.isEditable); }); }
    finally { this.busy = false; if (this.rendered) await this.render({ force: true }); }
  }
  static async linkedActor() {
    const actor = await fromUuid(this.document.system.linkedActorUuid);
    if (actor) return actor.sheet.render({ force: true });
    ui.notifications.warn("Связанный транспорт не найден.");
  }
}
