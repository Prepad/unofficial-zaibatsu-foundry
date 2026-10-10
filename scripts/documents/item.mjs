import { attack } from "../services/combat.mjs";
export class ZaibatsuItem extends foundry.documents.Item {
  async roll() {
    if (!this.actor) throw new Error("Перетащите оружие в лист персонажа.");
    return attack(this.actor, this);
  }
}
