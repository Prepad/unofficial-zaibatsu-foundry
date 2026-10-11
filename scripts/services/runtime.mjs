const queues = new Map();
export const clone = value => foundry.utils.deepClone(value);
export const now = () => game.time.worldTime;
export const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
export const primaryGM = () => {
  const users = game.users.filter(user => user.active && user.isGM).sort((a, b) => a.id.localeCompare(b.id));
  return users.find(user => user.id === game.settings.get("zaibatsu", "authorityGM")) ?? users[0];
};
export function serial(key, task) {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  queues.set(key, next);
  return next.finally(() => { if (queues.get(key) === next) queues.delete(key); });
}
export function guard(actor) {
  if (!actor?.isOwner) throw new Error("Для этого действия нужны права владельца.");
}
export async function notifyAction(task) {
  try { return await task(); }
  catch (error) { console.error("Zaibatsu", error); ui.notifications.error(error.message); return null; }
}
export function field(definition) {
  const { name, label, type = "text", value = "", options, min, max, step = 1, help = "" } = definition;
  const disabled = definition.disabled ? " disabled" : "";
  const attrs = `name="${escape(name)}"${disabled}`;
  let input;
  if (options) input = `<select ${attrs}>${options.map(option => `<option value="${escape(option.value)}"${String(option.value) === String(value) ? " selected" : ""}>${escape(option.label)}</option>`).join("")}</select>`;
  else if (type === "checkbox") input = `<input type="checkbox" ${attrs}${value ? " checked" : ""}>`;
  else if (type === "textarea") input = `<textarea ${attrs} rows="4">${escape(value)}</textarea>`;
  else input = `<input ${attrs} type="${escape(type)}" value="${escape(value)}"${min !== undefined ? ` min="${min}"` : ""}${max !== undefined ? ` max="${max}"` : ""}${type === "number" ? ` step="${step}"` : ""}>`;
  const hint = help ? `<small>${escape(help)}</small>` : "";
  if (type === "checkbox") return `<label class="zb-dialog-field">${input}<span>${escape(label)}${hint}</span></label>`;
  return `<label class="zb-dialog-field"><span>${escape(label)}</span>${input}${hint}</label>`;
}
export async function prompt(title, definitions, { text = "", accept = "Продолжить" } = {}) {
  return foundry.applications.api.DialogV2.prompt({ window: { title }, rejectClose: false,
    content: `<div class="zaibatsu zb-dialog">${text ? `<p>${escape(text)}</p>` : ""}${definitions.map(field).join("")}</div>`,
    ok: { label: accept, callback: (_event, button) => Object.fromEntries(definitions.map(def => {
      const element = button.form.elements.namedItem(def.name);
      const value = def.type === "checkbox" ? element.checked : def.type === "number" ? Number(element.value) : element.value;
      if (def.type === "number" && (!Number.isFinite(value) || (def.min !== undefined && value < def.min) || (def.max !== undefined && value > def.max) || (def.step !== "any" && !Number.isInteger(value)))) throw new Error(`Проверьте поле «${def.label}».`);
      return [def.name, value];
    })) }
  });
}
export async function chat(actor, title, text, flags = {}, { whisper } = {}) {
  return foundry.documents.ChatMessage.create({ speaker: foundry.documents.ChatMessage.getSpeaker({ actor }),
    content: `<article class="zaibatsu zb-chat"><h3>${escape(title)}</h3><div>${text}</div></article>`,
    flags: { zaibatsu: flags }, ...(whisper ? { whisper } : {}) });
}
export async function request(actor, command, payload = {}, { defer = false } = {}) {
  guard(actor);
  const gm = primaryGM();
  if (gm?.id === game.user.id && !defer) return game.zaibatsu.commands[command](actor, payload, game.user);
  const message = await chat(actor, "Действие Zaibatsu", escape(command), {
    request: { actorUuid: actor.uuid, command, payload, status: "pending" }
  }, { whisper: gm ? [gm.id, game.user.id] : game.users.filter(user => user.isGM).map(user => user.id).concat(game.user.id) });
  if (!gm) ui.notifications.info("Действие сохранено и будет выполнено после подключения ведущего.");
  return message;
}
export async function processRequest(message) {
  if (primaryGM()?.id !== game.user.id || message.getFlag("zaibatsu", "request")?.status !== "pending") return;
  return serial("gm-requests", async () => {
    const data = message.getFlag("zaibatsu", "request");
    if (data?.status !== "pending") return;
    try {
      const actor = await fromUuid(data.actorUuid);
      const user = message.author;
      if (!actor || !user || (!user.isGM && !actor.testUserPermission(user, "OWNER"))) throw new Error("Нет прав на персонажа запроса.");
      const command = game.zaibatsu.commands[data.command];
      if (!command) throw new Error("Неизвестное действие.");
      await command(actor, data.payload, user, message.id);
      await message.update({ "flags.zaibatsu.request.status": "done", content: `${message.content}<p>Выполнено.</p>` });
    } catch (error) {
      await message.update({ "flags.zaibatsu.request.status": "error", content: `${message.content}<p>${escape(error.message)}</p>` });
      ui.notifications.error(error.message);
    }
  });
}
export const tokenDistance = (a, b) => {
  if (!a || !b) return 1;
  return Math.round(canvas.grid.measurePath([a.center, b.center]).distance * 100) / 100;
};
export const roundKey = () => game.combat?.started ? `${game.combat.id}:${game.combat.round}` : "";
export const options = entries => entries.map(([value, label]) => ({ value, label }));
