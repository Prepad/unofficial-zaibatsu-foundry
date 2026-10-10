import { advancePhase } from "../services/combat.mjs";
export class ZaibatsuCombat extends foundry.documents.Combat {
  async nextTurn() { await advancePhase(this); return this; }
  async nextRound() { await advancePhase(this); return this; }
  async advanceZaibatsuRound() { return super.nextRound(); }
}
