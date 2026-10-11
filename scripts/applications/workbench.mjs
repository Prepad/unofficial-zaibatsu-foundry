import { CATALOG } from "../data/catalog.mjs";
import { cardLabel } from "../rules/cyberspace.mjs";
import { PHASE_NAMES } from "../services/combat.mjs";
import { ITEM_TYPES, WOUND_NAMES } from "../config.mjs";
import { now, notifyAction, roundKey } from "../services/runtime.mjs";
import { executeActorCommand } from "../services/actor-actions.mjs";

export class Workbench extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  static DEFAULT_OPTIONS = { classes: ["zaibatsu", "zb-workbench"], position: { width: 920, height: 780 }, window: { title: "Zaibatsu · Терминал", resizable: true }, actions: { do: Workbench.perform } };
  static PARTS = { main: { template: "systems/zaibatsu/templates/applications/workbench.hbs", scrollable: [".zb-panel-content"] } };
  static TABS = { primary: { initial: "actions", tabs: [{ id: "actions", label: "Действия" }, { id: "combat", label: "Бой" }, { id: "cyber", label: "Киберпространство" }, { id: "catalog", label: "Справочник" }] } };
  constructor(actor, options = {}) { super(options); this.actorUuid = actor?.uuid ?? ""; }
  get actor() { return this.currentActor; }
  async _prepareContext() {
    const actors = game.actors.filter(actor => actor.isOwner);
    this.currentActor = this.actorUuid ? await fromUuid(this.actorUuid) : game.user.character ?? actors[0];
    if (this.currentActor && !this.currentActor.isOwner) this.currentActor = null;
    if (this.currentActor) this.actorUuid = this.currentActor.uuid;
    const actor = this.currentActor;
    if (actor && !actors.some(entry => entry.uuid === actor.uuid)) actors.push(actor);
    const cyber = actor?.system.cyber ?? {};
    return { tabs: this._prepareTabs("primary"), gm: game.user.isGM, actor, system: actor?.system, vehicle: actor?.system.vehicle, transport: actor?.type === "vehicle", agent: !!actor?.system.skills, woundLabel: WOUND_NAMES[actor?.system.wounds?.severity] ?? "Корпус транспорта",
      agents: actors.map(actor => ({ uuid: actor.uuid, name: actor.name, selected: actor.uuid === this.actorUuid })),
      conditions: actor?.system.conditions?.map(state => ({ ...state, remaining: state.until ? `${Math.max(0, Math.ceil(state.until - now()))} с` : "постоянно" })),
      penalty: actor?.penalty ?? 0, retroPoints: actor?.system.advancement?.retroPoints ?? 0,
      combat: game.combat, phase: PHASE_NAMES[game.combat?.getFlag("zaibatsu", "phase") ?? "declaration"],
      combatants: game.combat?.combatants.filter(combatant => !combatant.hidden || game.user.isGM).map(combatant => ({ name: combatant.name, actorUuid: combatant.actor?.uuid, declaration: combatant.actor?.system.combatState?.declaration ?? "", action: combatant.actor?.system.combatState?.actionRound === roundKey() ? combatant.actor.system.combatState.action : "Доступно", aim: combatant.actor?.system.combatState?.aim ?? 0 })),
      pending: (game.combat?.getFlag("zaibatsu", "pending") ?? []).map(event => ({ ...event, targetName: game.actors.get(event.targetUuid?.split(".").at(-1))?.name ?? event.targetUuid, damageLabel: event.type === "shock" ? "шок" : "урон", phaseLabel: PHASE_NAMES[event.phase] ?? event.phase, chosen: !!event.choice })),
      cyber: { ...cyber, revealed: (cyber.revealed ?? []).map(entry => ({ node: entry.node, label: cardLabel(entry.card) })) },
      catalog: CATALOG.map(entry => ({ ...entry, typeLabel: game.i18n.localize(ITEM_TYPES[entry.type]), priceLabel: entry.system.price ? `¥${entry.system.price}` : "Цена не указана", isRetrogenic: entry.type === "retrogenic" })),
      networks: game.settings.get("zaibatsu", "networks"), programs: actor?.items.filter(item => item.type === "program").map(item => ({ id: item.id, name: item.name, rating: item.system.rating, used: cyber.used?.includes(item.id) })) };
  }
  async _onRender(context, options) {
    await super._onRender(context, options);
    game.zaibatsu.windows.add(this);
    this.element.querySelector('[name="actorUuid"]').addEventListener("change", async event => { this.actorUuid = event.target.value; await this.render(); });
    this.element.querySelector('[name="catalogSearch"]').addEventListener("input", event => {
      const text = event.target.value.toLocaleLowerCase();
      for (const row of this.element.querySelectorAll("[data-search]")) row.hidden = !row.dataset.search.toLocaleLowerCase().includes(text);
    });
  }
  _onClose(options) { game.zaibatsu.windows.delete(this); super._onClose(options); }
  static async perform(_event, target) {
    if (this.busy) return;
    this.busy = true;
    try { return await notifyAction(async () => { await this.execute(target.dataset.command, target.dataset); if (this.rendered) await this.render(); }); }
    finally { this.busy = false; }
  }
  async execute(command, data) { return executeActorCommand(this.actor, command, data); }
}
