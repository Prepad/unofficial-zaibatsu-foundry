import { SUITS, freshDeck, cardLabel, cardColor, cardValue, intrusionGuess, theftCards, PROCEDURES } from "../rules/cyberspace.mjs";
import { chat, clone, escape, now, prompt, serial } from "./runtime.mjs";
import { encryptNetwork, readNetwork, writeNetwork } from "./vault.mjs";

const random = () => CONFIG.Dice.randomUniform();
const networks = () => game.settings.get("zaibatsu", "networks");
const draw = state => {
  if (!state.main.length) state.main = freshDeck(random);
  const card = state.main.pop();
  state.discard.push(card);
  return card;
};
function publicState(state, session) {
  return { networkUuid: state.uuid, networkName: state.name, connected: session.connected, node: session.node,
    failures: session.failures, safeFailures: session.safeFailures, used: session.used,
    blockedUntil: session.blockedUntil, ice: session.ice, blackICE: session.blackICE,
    access: session.access, revealed: session.revealed, log: session.log.slice(-30), programs: session.programs,
    procedures: session.procedures, remote: session.remote, remainingCards: state.system.length,
    networkNodes: state.nodes.filter(node => !node.hidden || session.access.includes(node.id)).map(({ id, name, easy, parent }) => ({ id, name, easy, parent })) };
}
function eject(state, session, hours = 24, reason = "Тег: соединение разорвано") {
  session.connected = false; session.ice = null; session.blackICE = null;
  session.blockedUntil = now() + hours * 3600;
  state.system = freshDeck(random).slice(0, 10);
  session.log.push(reason);
}
function encounter(state, session) {
  const card = draw(state);
  session.log.push(`Проверка безопасности: ${cardLabel(card)}.`);
  if (cardColor(card) === "black") session.ice = { rating: cardValue(card), black: state.blackICE, card };
}
function programFor(actor, session, id, { ice = false } = {}) {
  const item = actor.items.get(id);
  if (!item || item.type !== "program" || !session.programs.includes(id)) throw new Error("Программа не загружена в деку.");
  if (session.used.includes(id)) throw new Error("Программа уже использована как ЛЕДокол в этой сессии.");
  if (ice && !item.system.icebreaker) throw new Error("Обычная программа не может взломать ЛЕД.");
  return item;
}
export async function createNetwork() {
  if (!game.user.isGM) throw new Error("Сети создаёт ведущий.");
  const data = await prompt("Новая компьютерная система", [
    { name: "name", label: "Название", value: "Сеть корпорации" },
    { name: "blackICE", label: "Использует Чёрный ЛЕД", type: "checkbox" },
    { name: "nodes", label: "Подсистемы: по одной на строку", type: "textarea", value: "База данных\nКамеры\nДвери\nФинансы", help: "Добавьте + в начале для простой подсистемы (цвет), ? для скрытой. До 9 подсистем; корень создаётся отдельно." }
  ]);
  if (!data) return;
  const names = data.nodes.split("\n").map(name => name.trim()).filter(Boolean);
  if (!data.name.trim() || names.length > 9) throw new Error("Нужны название и не больше 9 подсистем.");
  const nodes = [{ id: "root", name: "Корень", parent: "", easy: false, hidden: false },
    ...names.map((name, i) => ({ id: `node${i + 1}`, name: name.replace(/^[+?]+/, ""), easy: name.startsWith("+"), hidden: name.startsWith("?"), parent: "root" }))];
  const document = await foundry.documents.JournalEntry.create({ name: `Киберсистема: ${data.name}`, ownership: { default: 0 },
    flags: { zaibatsu: { network: await encryptNetwork({ name: data.name, nodes, blackICE: data.blackICE, system: freshDeck(random).slice(0, 10), main: freshDeck(random), discard: [], sessions: {}, tasks: [], history: [] }) } } });
  await game.settings.set("zaibatsu", "networks", [...networks(), { uuid: document.uuid, name: data.name }]);
  await game.settings.set("zaibatsu", "authorityGM", game.user.id);
  return document;
}
export async function cyberCommand(actor, payload, user, requestId = foundry.utils.randomID()) {
  if (!actor.system.skills) throw new Error("Этот актор не может пользоваться киберпространством.");
  const networkUuid = payload.networkUuid ?? actor.system.cyber.networkUuid;
  if (!networks().some(network => network.uuid === networkUuid)) throw new Error("Компьютерная система не найдена.");
  const document = await fromUuid(networkUuid);
  if (!document?.getFlag("zaibatsu", "network")) throw new Error("Ведущему нужно восстановить документ сети.");
  return serial(`network:${networkUuid}`, async () => {
    const state = await readNetwork(document);
    state.uuid = document.uuid;
    await deliverOutbox(document, state);
    let session = state.sessions[actor.uuid];
    if (session?.seen?.includes(requestId)) return;
    let advance = 0;
    let damage = 0;
    const effects = { actorUuid: actor.uuid, programUpdates: [], money: null, damage: 0, time: now(), requestId };
    const action = payload.action;
    if (action === "connect") {
      if (session?.connected) throw new Error("Соединение уже активно.");
      if (session?.blockedUntil > now()) throw new Error("Тег запрещает подключение до истечения блокировки.");
      const deck = actor.items.get(payload.deckId);
      if (deck?.type !== "cyberdeck") throw new Error("Выберите кибердеку.");
      const programs = [...new Set(payload.programs ?? [])];
      if (programs.length > deck.system.rating) throw new Error("Число программ превышает рейтинг деки.");
      if (programs.some(id => actor.items.get(id)?.type !== "program")) throw new Error("Неизвестная программа.");
      session = { connected: true, node: "root", failures: 0, safeFailures: Math.max(0, actor.system.skills.computers ?? 0),
        used: [], programs, access: [], revealed: [], log: ["Соединение установлено."], seen: [], procedures: [], remote: null, ice: null, blackICE: null, blockedUntil: 0 };
      state.sessions[actor.uuid] = session;
      for (const task of state.tasks.filter(task => task.actorUuid === actor.uuid && task.kind === "backdoor")) {
        session.access.push(task.node);
        const node = state.nodes.find(node => node.id === task.node);
        if (node?.parent && !session.access.includes(node.parent)) session.access.push(node.parent);
        session.log.push(`Чёрный ход: доступ к ${node?.name ?? task.node}.`);
      }
    } else {
      if (!session?.connected) throw new Error("Сначала подключитесь к системе.");
      if (action === "disconnect") {
        if (session.blackICE) throw new Error("Чёрный ЛЕД удерживает персонажа. Попробуйте вырваться.");
        session.connected = false; session.ice = null; session.log.push("Соединение завершено.");
      } else if (action === "breakICE") {
        if (!session.ice) throw new Error("ЛЕД не обнаружен.");
        const program = payload.programId ? programFor(actor, session, payload.programId, { ice: true }) : null;
        const rating = program?.system.rating ?? -1;
        const ice = session.ice;
        if (program) {
          session.used.push(program.id);
          effects.programUpdates.push({ _id: program.id, "system.rating": Math.max(0, rating - 1) });
          session.log.push(`${program.name}: рейтинг ${rating} → ${Math.max(0, rating - 1)} навсегда.`);
        }
        if (program && rating >= ice.rating) { session.ice = null; session.log.push(`ЛЕД ${ice.rating} преодолён.`); }
        else if (ice.black) { session.blackICE = { rating: ice.rating }; session.ice = null; session.log.push(`Чёрный ЛЕД ${ice.rating}: персонаж в ловушке.`); }
        else eject(state, session, 24, "ЛЕД поставил тег. Блокировка на 24 часа.");
      } else if (action === "escape") {
        if (!session.blackICE) throw new Error("Чёрный ЛЕД не удерживает персонажа.");
        advance = 120;
        const card = draw(state);
        session.log.push(`Побег: ${cardLabel(card)}.`);
        if (cardColor(card) === "black") { damage = (await new foundry.dice.Roll("2d6").evaluate()).total; session.log.push(`Чёрный ЛЕД наносит ${damage} урона.`); }
        else if (cardValue(card) >= session.blackICE.rating + 2) eject(state, session, 24, "Удалось вырваться из Чёрного ЛЕДа. Тег на 24 часа.");
        else session.log.push("Попытка побега не удалась.");
      } else {
        if (session.ice || session.blackICE) throw new Error("Сначала разрешите столкновение с ЛЕДом.");
        if (action === "guess") {
          const node = state.nodes.find(node => node.id === payload.node);
          if (!node || node.disabled || (node.hidden && !session.access.includes(node.id))) throw new Error("Подсистема недоступна.");
          if (node.parent && !session.access.includes(node.parent)) throw new Error("Сначала взломайте корневую систему.");
          if (session.access.includes(node.id)) throw new Error("Доступ к этой подсистеме уже открыт.");
          if (!(node.easy ? ["black", "red"] : Object.keys(SUITS)).includes(payload.guess)) throw new Error("Неизвестная масть / цвет.");
          advance = 120;
          if (!state.system.length) {
            eject(state, session, 24, "Системная колода исчерпана: тег и новая колода. Блокировка на 24 часа.");
          } else {
          const card = state.system.pop();
          const success = intrusionGuess(card, payload.guess, node.easy);
          session.log.push(`${node.name}: ${success ? `доступ открыт (${cardLabel(card)})` : "неверное предположение"}.`);
          if (success) { session.access.push(node.id); session.node = node.id; session.revealed.push({ node: node.id, card }); }
          else { session.failures++; if (session.failures > session.safeFailures) encounter(state, session); }
          }
        } else if (action === "procedure") {
          if ((actor.system.skills.computers ?? 0) < 1) throw new Error("Специальные процедуры требуют Компьютеры 1+.");
          if (!session.access.includes(payload.node ?? session.node) || state.nodes.find(node => node.id === (payload.node ?? session.node))?.disabled) throw new Error("Нужен доступ к действующей подсистеме.");
          const name = PROCEDURES[payload.procedure];
          if (!name) throw new Error("Неизвестная процедура.");
          const program = programFor(actor, session, payload.programId, { ice: true });
          const rating = program.system.rating;
          const amount = Number(payload.amount ?? 0);
          const skill = actor.system.skills.computers;
          let success = false;
          advance = 120;
          const cards = [];
          if (payload.procedure === "newIdentity") {
            if ((actor.system.skills.forgery ?? 0) < 1) throw new Error("Создание личности требует Подделка 1+.");
            state.tasks.push({ id: foundry.utils.randomID(), actorUuid: actor.uuid, kind: "newIdentity", node: payload.node ?? session.node,
              rating, name: payload.identity?.trim() || "Новая цифровая личность", nextCheck: now() + 604800, cards: [], failures: 0, successes: 0 });
            success = true;
            session.log.push("Новая личность: работа запланирована на 4 недели, одна проверка в неделю.");
          } else if (payload.procedure === "bugHunter") {
            const interceptor = Math.max(Number(payload.interceptor ?? 0), ...state.tasks.filter(task => task.kind === "fileInterceptor" && task.node === (payload.node ?? session.node)).map(task => task.rating));
            success = rating + skill > interceptor;
            if (success) state.tasks = state.tasks.filter(task => task.kind !== "fileInterceptor" || task.node !== (payload.node ?? session.node));
          } else {
            const count = payload.procedure === "thief" ? theftCards(amount) : payload.procedure === "search" ? Math.max(1, Math.min(3, Number(payload.fragments) || 1)) : 1;
            if (payload.procedure === "thief" && (!Number.isInteger(amount) || amount < 1)) throw new Error("Укажите положительную сумму.");
            for (let i = 0; i < count; i++) cards.push(draw(state));
            success = cards.every(card => rating >= cardValue(card));
            if (payload.procedure === "thief") for (let i = 0; i < count; i++) {
              const security = draw(state);
              session.log.push(`Проверка ЛЕДа: ${cardLabel(security)}.`);
              if (security.suit === "spades" && !session.ice) session.ice = { rating: cardValue(security), black: state.blackICE, card: security };
            }
          }
          if (payload.procedure === "rewriter" && !success) {
            advance = 3600;
            success = true;
            session.log.push("Рейтинг недостаточен для мгновенной записи; работа заняла час.");
            const security = draw(state);
            session.log.push(`Проверка ЛЕДа: ${cardLabel(security)}.`);
            if (security.suit === "spades") eject(state, session, 24, "Переписчик обнаружен: тег на 24 часа.");
          }
          if (payload.procedure === "search") {
            const count = cards.filter(card => rating >= cardValue(card)).length;
            const hidden = state.nodes.filter(node => node.hidden && !session.access.includes(node.id)).slice(0, count);
            for (const node of hidden) { node.hidden = false; session.log.push(`Обнаружено: ${node.name}.`); }
          }
          if (payload.procedure === "remoteControl") {
            const distance = Number(payload.distance ?? 0);
            if (distance > 50) throw new Error("Удалённый контроль действует в пределах 50 м.");
            const attempts = (session.remote?.attempts ?? 0) + 1;
            if (attempts > skill + 1) throw new Error("Безуспешные попытки удалённого контроля исчерпаны.");
            session.remote = { active: success, commands: 0, attempts, rating, node: payload.node ?? session.node };
          }
          if (success && ["informationTrail", "fileInterceptor", "backdoor", "logicBomb"].includes(payload.procedure)) {
            const node = payload.node ?? session.node;
            const cooldown = state.cooldowns?.[`${actor.uuid}:${payload.procedure}:${node}`] ?? 0;
            if (cooldown > now()) throw new Error("После обнаружения нужно подождать 24 часа.");
            state.tasks.push({ id: foundry.utils.randomID(), actorUuid: actor.uuid, kind: payload.procedure, node, rating,
              checks: payload.procedure === "backdoor" && node !== "root" ? 2 : 1,
              nextCheck: now() + (payload.procedure === "logicBomb" ? Math.max(60, Number(payload.delay) || 3600) : 86400) });
          }
          if (success && payload.procedure === "thief") effects.money = actor.system.money + amount;
          const outcome = { name, success, cards: cards.map(cardLabel), time: now() + advance };
          session.procedures.push(outcome);
          session.log.push(`${name}: ${success ? "успех" : "неудача"}${cards.length ? ` — ${cards.map(cardLabel).join(", ")}` : ""}.`);
        } else if (action === "remoteCommand") {
          if (!session.remote?.active) throw new Error("Удалённый контроль не установлен.");
          session.remote.commands++;
          if (session.remote.commands > session.remote.rating) {
            const card = draw(state); session.log.push(`Удалённая команда: ${cardLabel(card)}.`);
            if (card.suit === "spades") eject(state, session, 24, "Удалённый контроль обнаружен: тег на 24 часа.");
          }
          if (session.connected) session.log.push(`Команда: ${String(payload.command ?? "").slice(0, 200)}.`);
        } else throw new Error("Неизвестное действие киберпространства.");
      }
    }
    session.seen = [...(session.seen ?? []), requestId].slice(-200);
    session.log = session.log.slice(-100);
    session.procedures = session.procedures.slice(-30);
    effects.damage = damage;
    effects.time = now() + advance;
    effects.summary = publicState(state, session);
    state.outbox = effects;
    await writeNetwork(document, state);
    await deliverOutbox(document, state);
    await chat(actor, state.name, escape(session.log.at(-1)), {}, { whisper: [...new Set([user.id, ...game.users.filter(user => user.isGM).map(user => user.id)])] });
  });
}

async function deliverOutbox(document, state) {
  const effects = state.outbox;
  if (!effects) return;
  const actor = await fromUuid(effects.actorUuid);
  if (!actor) throw new Error("Персонаж сетевой сессии удалён; ведущему нужно восстановить его.");
  if (effects.programUpdates.length) await actor.updateEmbeddedDocuments("Item", effects.programUpdates);
  await actor.update({ "system.cyber": effects.summary, ...(effects.money !== null ? { "system.money": effects.money } : {}) });
  if (effects.damage) await actor.applyDamage({ id: `blackICE:${effects.requestId}`, amount: effects.damage });
  if (effects.time > now()) await game.time.advance(effects.time - now());
  delete state.outbox;
  await writeNetwork(document, state);
}
export async function resumeCyber() {
  for (const network of networks()) {
    const document = await fromUuid(network.uuid);
    if (!document) continue;
    const state = await readNetwork(document);
    if (state.outbox) await serial(`network:${network.uuid}`, async () => deliverOutbox(document, await readNetwork(document)));
  }
}

export async function cyberDaily(time) {
  for (const network of networks()) {
    const document = await fromUuid(network.uuid);
    if (!document) continue;
    await serial(`network:${network.uuid}`, async () => {
      const state = await readNetwork(document);
      if (!state?.tasks?.some(task => task.nextCheck <= time)) return;
      for (const task of [...state.tasks]) {
        if (task.nextCheck > time) continue;
        const actor = await fromUuid(task.actorUuid);
        if (task.kind === "logicBomb") {
          state.tasks = state.tasks.filter(entry => entry.id !== task.id);
          state.history.push({ kind: task.kind, node: task.node, time, text: "Логическая бомба сработала: подсистема выведена из строя." });
          const node = state.nodes.find(node => node.id === task.node);
          if (node) node.disabled = true;
          if (actor) await chat(actor, "Логическая бомба", escape(`${state.name}: ${node?.name ?? task.node} выведена из строя.`));
          continue;
        }
        if (task.kind === "newIdentity") {
          while (task.nextCheck <= time && task.cards.length < 4) {
            const card = draw(state); task.cards.push(card);
            if (task.rating >= cardValue(card)) task.successes++; else task.failures++;
            task.nextCheck += 604800;
          }
          if (task.cards.length === 4) {
            if (actor && task.successes && !actor.items.some(item => item.system.identity.taskId === task.id)) await actor.createEmbeddedDocuments("Item", [{ name: task.name, type: "gear", system: {
              price: 100000, slots: 0, description: `Фальшивая ID-карта. Порог обнаружения ${12 - task.failures}+ на 2d6.`, identity: { threshold: 12 - task.failures, taskId: task.id } } }]);
            state.tasks = state.tasks.filter(entry => entry.id !== task.id);
            if (actor) await chat(actor, "Создание личности завершено", escape(task.successes ? `${task.name}: карта добавлена в инвентарь.` : "Все четыре проверки неудачны: личность не создана."), {}, { whisper: game.users.filter(user => user.isGM || actor.testUserPermission(user, "OWNER")).map(user => user.id) });
          }
          continue;
        }
        let found = false;
        const days = Math.min(365, Math.floor((time - task.nextCheck) / 86400) + 1);
        for (let day = 0; day < days; day++) {
          for (let check = 0; check < (task.checks ?? 1); check++) if (cardValue(draw(state)) > task.rating) { found = true; break; }
          if (found) break;
        }
        task.nextCheck = time + 86400;
        if (found) {
          state.tasks = state.tasks.filter(entry => entry.id !== task.id);
          if (task.kind === "informationTrail") { state.cooldowns ??= {}; state.cooldowns[`${task.actorUuid}:${task.kind}:${task.node}`] = time + 86400; }
          if (actor) await chat(actor, "Сетевая процедура обнаружена", escape(`${PROCEDURES[task.kind]}: ${state.name}`), {}, { whisper: game.users.filter(user => user.isGM || actor.testUserPermission(user, "OWNER")).map(user => user.id) });
        }
      }
      await writeNetwork(document, state);
    });
  }
}
