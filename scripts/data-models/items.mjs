import { SKILLS } from "../config.mjs";

const { NumberField, StringField, BooleanField, ObjectField } = foundry.data.fields;
const number = (initial = 0, min = 0) => new NumberField({ required: true, integer: true, min, initial });

export class GearData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      schemaVersion: number(2, 1),
      catalogId: new StringField({ initial: "", blank: true }),
      slots: number(1),
      identity: new ObjectField({ initial: {} }),
      linkedActorUuid: new StringField({ initial: "", blank: true }),
      description: new StringField({ required: true, blank: true, initial: "" }),
      quantity: number(1),
      price: number(),
      equipped: new BooleanField({ initial: false })
    };
  }
}

export class WeaponData extends GearData {
  static defineSchema() {
    return { ...super.defineSchema(),
      skill: new StringField({ required: true, blank: false, choices: Object.keys(SKILLS), initial: "shooting" }),
      damage: new StringField({ required: true, blank: false, initial: "2d6" }),
      range: number(),
      maximumRange: number(),
      ammunition: number(), capacity: number(), reserve: number(),
      maxAttacks: number(1, 1),
      kind: new StringField({ initial: "ranged", choices: ["melee", "ranged", "thrown"] }),
      damageType: new StringField({ initial: "damage", choices: ["damage", "shock"] }),
      special: new StringField({ initial: "", blank: true }),
      penetration: number(), attackBonus: new NumberField({ integer: true, initial: 0 }),
      sightBonus: number(), laser: new BooleanField({ initial: false }),
      shotgun: new BooleanField({ initial: false }), jammed: new BooleanField({ initial: false }),
      fired: new BooleanField({ initial: false })
    };
  }
}

export class ArmorData extends GearData {
  static defineSchema() { return { ...super.defineSchema(), protection: number() }; }
}

export class RetrogenicData extends GearData {
  static defineSchema() { return { ...super.defineSchema(), points: number(),
    effectKey: new StringField({ initial: "", blank: true }), activeUntil: number(), cooldownUntil: number() }; }
}

export class CyberdeckData extends GearData {
  static defineSchema() { return { ...super.defineSchema(), rating: number(1, 1) }; }
}

export class ProgramData extends GearData {
  static defineSchema() { return { ...super.defineSchema(), rating: number(1), icebreaker: new BooleanField({ initial: true }) }; }
}
