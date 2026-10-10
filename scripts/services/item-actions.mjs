import { executeActorCommand } from "./actor-actions.mjs";
import { guard } from "./runtime.mjs";

export const ITEM_ACTIONS = [
  { id: "attack", command: "attack", label: "Атаковать", icon: "fa-solid fa-crosshairs" },
  { id: "aim", command: "aim", label: "Целиться", icon: "fa-solid fa-bullseye" },
  { id: "reload", command: "reload", label: "Перезарядить", icon: "fa-solid fa-rotate" },
  { id: "retrogen", command: "retrogen", label: "Использовать адаптацию", icon: "fa-solid fa-dna" },
  { id: "connect", command: "connect", label: "Подключиться с этой декой", icon: "fa-solid fa-plug" },
  { id: "disconnect", command: "disconnect", label: "Отключиться от сети", icon: "fa-solid fa-power-off" },
  { id: "procedure", command: "procedure", label: "Запустить процедуру", icon: "fa-solid fa-terminal" },
  { id: "breakICE", command: "breakICE", label: "Применить ЛЕДокол", icon: "fa-solid fa-unlock" },
  { id: "identity", command: "identity", label: "Проверить ID-карту", icon: "fa-solid fa-id-card" },
  { id: "aid", command: "aid", label: "Оказать медпомощь", icon: "fa-solid fa-kit-medical" },
  { id: "linkedActor", command: "linkedActor", label: "Открыть транспорт", icon: "fa-solid fa-car" },
  { id: "itemInfo", command: "itemInfo", label: "Показать описание в чате", icon: "fa-solid fa-comment" },
  { id: "equip", label: "Надеть / снять", icon: "fa-solid fa-hand" },
  { id: "favorite", label: "Добавить / убрать из избранного", icon: "fa-solid fa-star" },
  { id: "open", label: "Открыть предмет", icon: "fa-solid fa-book-open" },
  { id: "delete", label: "Удалить предмет", icon: "fa-solid fa-trash" }
];

export function itemActions(actor, item, editable = actor.isOwner) {
  const cyber = actor.system.cyber ?? {};
  const allowed = new Set(["open"]);
  if (editable) {
    for (const id of ["itemInfo", "favorite", "equip", "delete"]) allowed.add(id);
    if (actor.system.skills && item.system.quantity > 0) {
      if (item.type === "weapon") {
        allowed.add("attack");
        if (item.system.kind === "ranged") { allowed.add("aim"); allowed.add("reload"); }
      }
      if (item.type === "retrogenic" && item.system.equipped) allowed.add("retrogen");
      if (item.type === "cyberdeck") allowed.add(cyber.connected ? "disconnect" : "connect");
      if (item.type === "program" && cyber.connected && cyber.programs?.includes(item.id) && !cyber.used?.includes(item.id)) {
        allowed.add("procedure");
        if (item.system.icebreaker && cyber.ice) allowed.add("breakICE");
      }
      if (item.system.identity?.threshold) allowed.add("identity");
      if (["drugs", "medkit", "doctorBag", "medicalKit"].includes(item.system.catalogId)) allowed.add("aid");
    }
  }
  if (item.system.linkedActorUuid) allowed.add("linkedActor");
  return ITEM_ACTIONS.filter(action => allowed.has(action.id));
}

export async function performItemAction(actor, item, id, editable = actor.isOwner) {
  if (!item) throw new Error("Предмет уже удалён из инвентаря.");
  const action = itemActions(actor, item, editable).find(entry => entry.id === id);
  if (!action) throw new Error("Это действие сейчас недоступно для предмета.");
  if (id === "open") return item.sheet.render({ force: true });
  if (id === "linkedActor") {
    const linked = await fromUuid(item.system.linkedActorUuid);
    if (!linked?.visible) throw new Error("Связанный транспорт недоступен.");
    return linked.sheet.render({ force: true });
  }
  guard(actor);
  if (id === "favorite") return item.update({ "system.favorite": !item.system.favorite });
  if (id === "equip") return item.update({ "system.equipped": !item.system.equipped });
  if (id === "delete") return item.deleteDialog();
  return executeActorCommand(actor, action.command, { itemId: item.id });
}

export function inventoryContext(actor, editable = actor.isOwner) {
  return [...actor.items].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)).map(item => {
    const actions = itemActions(actor, item, editable);
    return {
    id: item.id, uuid: item.uuid, name: item.name, img: item.img, type: item.type,
    quantity: item.system.quantity, equipped: item.system.equipped, favorite: item.system.favorite,
    isWeapon: item.type === "weapon", damage: item.system.damage,
    ranged: item.type === "weapon" && item.system.kind === "ranged",
    ammo: item.system.ammunition, capacity: item.system.capacity, rating: item.system.rating,
    primary: actions.find(action => action.id === "breakICE") ?? actions.find(action => action.command && action.id !== "itemInfo")
  }; });
}
