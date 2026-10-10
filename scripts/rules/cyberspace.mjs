export const SUITS = { spades: "Пики", clubs: "Трефы", hearts: "Червы", diamonds: "Бубны" };
export function cardColor(card) { return ["spades", "clubs"].includes(card.suit) ? "black" : "red"; }
export function cardValue(card) { return Math.min(card.rank, 10); }
export function cardLabel(card) { return `${{ 1: "Туз", 11: "Валет", 12: "Дама", 13: "Король" }[card.rank] ?? card.rank} · ${SUITS[card.suit]}`; }
export function freshDeck(random) {
  const deck = Object.keys(SUITS).flatMap(suit => Array.from({ length: 13 }, (_, index) => ({ suit, rank: index + 1 })));
  for (let index = deck.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [deck[index], deck[other]] = [deck[other], deck[index]];
  }
  return deck;
}
export function intrusionGuess(card, choice, easy = false) {
  return easy ? cardColor(card) === choice : card.suit === choice;
}
export function iceCheck(card, program) {
  return { rating: cardValue(card), triggered: cardColor(card) === "black",
    defeated: !!program && program.rating >= cardValue(card) && !program.used };
}
export function theftCards(amount) {
  if (amount <= 10000) return 1;
  if (amount <= 20000) return 2;
  if (amount <= 100000) return 3;
  if (amount <= 200000) return 4;
  if (amount <= 1000000) return 5;
  if (amount <= 2000000) return 6;
  throw new RangeError("Сумма превышает таблицу цифровой кражи.");
}
export const PROCEDURES = {
  bugHunter: "Ловец жучков", logicBomb: "Логическая бомба", informationTrail: "Информационный след",
  newIdentity: "Новая личность", rewriter: "Переписчик", fileInterceptor: "Перехватчик файлов",
  search: "Пойди-найди", remoteControl: "Удалённый контроль", backdoor: "Чёрный ход", thief: "Цифровой воришка"
};
