// Rules are independent of Foundry and the sheet implementation.
function integer(value, name) {
  if (!Number.isInteger(value)) throw new TypeError(`${name} must be an integer`);
  return value;
}

export function skillModifier(level) {
  if (level === null || level === undefined) return -3;
  integer(level, "Skill level");
  if (level < 0) throw new RangeError("Skill level cannot be negative");
  return level;
}

export function characteristicModifier(value) {
  integer(value, "Characteristic");
  if (value < 0 || value > 15) throw new RangeError("Characteristic must be between 0 and 15");
  return Math.floor(value / 2);
}

export function checkResult(total, target, { graded = false } = {}) {
  integer(total, "Total");
  integer(target, "Target");
  const effect = total - target;
  let outcome = effect >= 0 ? "success" : "failure";
  if (graded && effect >= 6) outcome = "exceptionalSuccess";
  if (graded && effect <= -6) outcome = "exceptionalFailure";
  return { total, target, effect, success: effect >= 0, outcome, graded };
}

export function personalProfile(attributes) {
  return ["strength", "dexterity", "endurance", "intelligence", "education", "social"]
    .map(key => {
      const value = attributes[key].value;
      characteristicModifier(value);
      return value.toString(16).toUpperCase();
    }).join("");
}
