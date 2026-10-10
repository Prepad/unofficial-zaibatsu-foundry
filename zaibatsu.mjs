import { CharacterData, NPCData, AndroidData, VehicleData } from "./scripts/data-models/actors.mjs";
import { GearData, WeaponData, ArmorData, RetrogenicData, CyberdeckData, ProgramData } from "./scripts/data-models/items.mjs";
import { ZaibatsuActor } from "./scripts/documents/actor.mjs";
import { ZaibatsuItem } from "./scripts/documents/item.mjs";
import { ZaibatsuCombat } from "./scripts/documents/combat.mjs";
import { ZaibatsuActorSheet, VehicleSheet } from "./scripts/sheets/actor-sheet.mjs";
import { ZaibatsuItemSheet } from "./scripts/sheets/item-sheet.mjs";
import * as rules from "./scripts/rules/checks.mjs";
import { ATTRIBUTES, SKILLS, ITEM_TYPES } from "./scripts/config.mjs";
import { Workbench } from "./scripts/applications/workbench.mjs";
import { CharacterCreator } from "./scripts/applications/creator.mjs";
import { attack, queueDamage, treatment, advancePhase } from "./scripts/services/combat.mjs";
import { cyberCommand } from "./scripts/services/cyberspace.mjs";
import { registerSettings, registerHooks, migrate, opposed } from "./scripts/services/setup.mjs";
import { notifyAction } from "./scripts/services/runtime.mjs";
import { drive } from "./scripts/services/vehicles.mjs";

Hooks.once("init", () => {
  CONFIG.Actor.documentClass = ZaibatsuActor;
  CONFIG.Item.documentClass = ZaibatsuItem;
  CONFIG.Combat.documentClass = ZaibatsuCombat;
  CONFIG.time.roundTime = 6;
  CONFIG.time.turnTime = 0;
  if (!CONFIG.statusEffects.some(effect => effect.id === "burning")) CONFIG.statusEffects.push({ id: "burning", name: "Горит", img: "icons/svg/fire.svg" });
  Object.assign(CONFIG.Actor.dataModels, { character: CharacterData, npc: NPCData, android: AndroidData, vehicle: VehicleData });
  Object.assign(CONFIG.Item.dataModels, {
    weapon: WeaponData, armor: ArmorData, gear: GearData,
    retrogenic: RetrogenicData, cyberdeck: CyberdeckData, program: ProgramData
  });
  CONFIG.Actor.trackableAttributes ??= {};
  for (const type of ["character", "npc", "android"]) {
    CONFIG.Actor.trackableAttributes[type] = {
      bar: ["attributes.strength", "attributes.dexterity", "attributes.endurance"],
      value: ["money"]
    };
  }
  const sheets = foundry.applications.apps.DocumentSheetConfig;
  sheets.registerSheet(foundry.documents.Actor, "zaibatsu", ZaibatsuActorSheet, {
    types: ["character", "npc", "android"], makeDefault: true, label: "ZAIBATSU.Sheets.Actor"
  });
  sheets.registerSheet(foundry.documents.Actor, "zaibatsu", VehicleSheet, { types: ["vehicle"], makeDefault: true, label: "Транспорт Zaibatsu" });
  sheets.registerSheet(foundry.documents.Item, "zaibatsu", ZaibatsuItemSheet, {
    types: Object.keys(ITEM_TYPES), makeDefault: true, label: "ZAIBATSU.Sheets.Item"
  });
  game.zaibatsu = { rules, config: { ATTRIBUTES, SKILLS, ITEM_TYPES }, windows: new Set(),
    commands: { queueDamage, treatment, cyber: cyberCommand, opposed, drive },
    safe: notifyAction, attack, advancePhase,
    terminal: actor => new Workbench(actor).render({ force: true }),
    createCharacter: () => new CharacterCreator().render({ force: true }) };
  registerSettings();
  registerHooks();
});

Hooks.once("ready", () => notifyAction(() => migrate()));
