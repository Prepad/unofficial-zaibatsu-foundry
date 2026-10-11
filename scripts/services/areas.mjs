// Foundry 14 migrates legacy MeasuredTemplates into Regions, preserving flags.
// Read Regions directly so existing Zaibatsu zones also continue to work.
export async function createArea(scene, { source, special, x, y, radius, until }) {
  if (scene.regions.some(region => region.getFlag("zaibatsu", "source") === source)) return;
  const radiusPixels = radius * scene.grid.size / scene.grid.distance;
  return scene.createEmbeddedDocuments("Region", [{
    name: special === "smoke" ? "Zaibatsu · Дым" : "Zaibatsu · Зона воздействия",
    color: special === "smoke" ? "#839599" : "#e29a3b",
    shapes: [{ type: "circle", x, y, radius: radiusPixels, gridBased: false }],
    visibility: CONST.REGION_VISIBILITY.ALWAYS,
    highlightMode: "coverage", displayMeasurements: true,
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE, [game.user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
    flags: { zaibatsu: { source, special, until } }
  }]);
}

export function smokePenalty(scene, source, destination, time) {
  if (!scene || !source || !destination) return 0;
  let modifier = 0;
  for (const region of scene.regions.filter(entry => entry.getFlag("zaibatsu", "special") === "smoke" && entry.getFlag("zaibatsu", "until") > time)) {
    for (const shape of region.shapes) {
      if (shape.type !== "circle") continue;
      for (const token of [source, destination]) {
        const distance = Math.hypot(token.center.x - shape.x, token.center.y - shape.y);
        if (distance <= shape.radius) modifier = Math.min(modifier, distance <= shape.radius / 2 ? -2 : -1);
      }
    }
  }
  return modifier;
}

export async function expireAreas(scene, time) {
  const expired = scene.regions.filter(region => region.getFlag("zaibatsu", "until") && region.getFlag("zaibatsu", "until") <= time).map(region => region.id);
  if (expired.length) await scene.deleteEmbeddedDocuments("Region", expired);
}
