export async function askModifier(title) {
  const content = await foundry.applications.handlebars.renderTemplate(
    "systems/zaibatsu/templates/applications/roll-dialog.hbs", {}
  );
  return foundry.applications.api.DialogV2.prompt({
    window: { title },
    content,
    rejectClose: false,
    ok: {
      label: game.i18n.localize("ZAIBATSU.Roll.Submit"),
      callback: (_event, button) => {
        const value = Number(button.form.elements.namedItem("modifier").value);
        if (!Number.isInteger(value)) throw new Error(game.i18n.localize("ZAIBATSU.Roll.InvalidModifier"));
        return value;
      }
    }
  });
}
