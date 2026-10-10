import { ATTRIBUTES, SKILLS } from "../config.mjs";
import { characteristicModifier, personalProfile } from "../rules/checks.mjs";

const { NumberField, StringField, SchemaField, BooleanField, ArrayField, ObjectField } = foundry.data.fields;
const vehicleSchema = (size = "medium", armor = 2, disabledAt = 15, destroyedAt = 30) => new SchemaField({
  size: new StringField({ initial: size, choices: ["small", "medium", "large"] }),
  mode: new StringField({ initial: "ground", choices: ["ground", "grav"] }),
  armor: new NumberField({ initial: armor, integer: true, min: 0 }),
  damage: new NumberField({ initial: 0, integer: true, min: 0 }),
  disabledAt: new NumberField({ initial: disabledAt, integer: true, min: 1 }),
  destroyedAt: new NumberField({ initial: destroyedAt, integer: true, min: 1 }),
  speed: new NumberField({ initial: 0, min: 0 }),
  driver: new StringField({ initial: "", blank: true }),
  passengers: new ArrayField(new StringField(), { initial: [] })
});

class AgentData extends foundry.abstract.TypeDataModel {
  static basicTraining = false;

  static defineSchema() {
    return {
      schemaVersion: new NumberField({ required: true, integer: true, initial: 2, min: 1 }),
      created: new BooleanField({ initial: false }),
      wounds: new SchemaField({
        severity: new StringField({ initial: "healthy", choices: ["healthy", "minor", "wounded", "serious", "dead"] }),
        penalty: new BooleanField({ initial: false }),
        bleeding: new BooleanField({ initial: false }),
        stabilized: new BooleanField({ initial: false }),
        nextBleed: new NumberField({ initial: 0, min: 0 }),
        unconsciousUntil: new NumberField({ initial: 0, min: 0 }),
        shock: new NumberField({ initial: 0, min: 0 })
      }),
      conditions: new ArrayField(new ObjectField(), { initial: [] }),
      appliedEvents: new ArrayField(new StringField(), { initial: [] }),
      combatState: new ObjectField({ initial: {} }),
      cyber: new ObjectField({ initial: {} }),
      contacts: new ArrayField(new ObjectField(), { initial: [] }),
      experience: new NumberField({ integer: true, initial: 0, min: 0 }),
      advancement: new ObjectField({ initial: { retroPoints: 0 } }),
      recovery: new ObjectField({ initial: { resting: false, lastRecovery: 0 } }),
      concept: new StringField({ required: true, blank: true, initial: "" }),
      age: new NumberField({ required: true, integer: true, min: 0, initial: 24 }),
      rank: new NumberField({ required: true, integer: true, min: 0, initial: 1 }),
      money: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),
      biography: new StringField({ required: true, blank: true, initial: "" }),
      attributes: new SchemaField(Object.fromEntries(Object.keys(ATTRIBUTES).map(key => [key,
        new SchemaField({
          value: new NumberField({ required: true, integer: true, min: 0, max: 15, initial: 7 }),
          max: new NumberField({ required: true, integer: true, min: 0, max: 15, initial: 7 })
        })
      ]))),
      skills: new SchemaField(Object.fromEntries(Object.entries(SKILLS).map(([key, skill]) => [key,
        new NumberField({ required: true, nullable: true, integer: true, min: 0,
          initial: this.basicTraining && skill.basic ? 0 : null })
      ])))
    };
  }

  prepareDerivedData() {
    this.profile = personalProfile(this.attributes);
    this.modifiers = Object.fromEntries(Object.entries(this.attributes)
      .map(([key, attribute]) => [key, characteristicModifier(attribute.value)]));
  }
}

export class CharacterData extends AgentData {
  static basicTraining = true;
}

export class NPCData extends AgentData {}

export class AndroidData extends AgentData {
  static defineSchema() {
    return { ...super.defineSchema(), vehicle: vehicleSchema("small", 2, 10, 20) };
  }
}

export class VehicleData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return { schemaVersion: new NumberField({ integer: true, initial: 2 }),
      vehicle: vehicleSchema(),
      biography: new StringField({ initial: "", blank: true }),
      appliedEvents: new ArrayField(new StringField(), { initial: [] }),
      combatState: new ObjectField({ initial: {} }) };
  }
}
