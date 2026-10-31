const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const {
  ANIMALS,
  BET_AMOUNTS,
  PAYOUTS,
  dezenaFromMilhar,
  groupFromDezena,
  groupFromMilhar,
  getAnimalByGroup,
  pickDailyDraw,
  formatDrawPrizes,
  isValidBetInput,
  resolveBichoBet,
  sortTodayWinners,
} = require("../../api/lib/bicho");

describe("ANIMALS — tabela clássica dos 25 bichos", () => {
  test("tem exatamente 25 grupos numerados de 1 a 25", () => {
    assert.equal(ANIMALS.length, 25);
    ANIMALS.forEach((a, i) => {
      assert.equal(a.group, i + 1);
      assert.ok(a.name);
      assert.ok(a.emoji);
      assert.equal(a.dezenas.length, 4);
    });
  });

  test("as 100 dezenas (00 a 99) estão cobertas sem repetição e mapeiam pro grupo certo", () => {
    const seen = new Set();
    for (const animal of ANIMALS) {
      for (const dez of animal.dezenas) {
        assert.match(dez, /^\d{2}$/);
        assert.ok(!seen.has(dez), `dezena duplicada: ${dez}`);
        seen.add(dez);
        assert.equal(groupFromDezena(dez), animal.group);
      }
    }
    assert.equal(seen.size, 100);
  });

  test("casos clássicos: 01–04 é Avestruz (1) e 97–00 é Vaca (25)", () => {
    assert.equal(groupFromDezena("01"), 1);
    assert.equal(groupFromDezena("04"), 1);
    assert.equal(groupFromDezena("97"), 25);
    assert.equal(groupFromDezena("00"), 25);
    assert.equal(getAnimalByGroup(1).name, "Avestruz");
    assert.equal(getAnimalByGroup(24).name, "Veado");
    assert.equal(getAnimalByGroup(25).name, "Vaca");
  });

  test("dezenaFromMilhar e groupFromMilhar extraem os 2 últimos dígitos", () => {
    assert.equal(dezenaFromMilhar("4321"), "21");
    assert.equal(groupFromMilhar("4321"), 6); // Cabra (21-24)
    assert.equal(dezenaFromMilhar("0000"), "00");
    assert.equal(groupFromMilhar("0000"), 25); // Vaca (97-00)
  });
});

describe("pickDailyDraw e formatDrawPrizes", () => {
  test("é determinístico para a mesma data e retorna 5 milhares de 4 dígitos", () => {
    const draw1 = pickDailyDraw("2026-10-31");
    const draw2 = pickDailyDraw("2026-10-31");
    assert.deepEqual(draw1, draw2);
    assert.equal(draw1.length, 5);
    for (const m of draw1) assert.match(m, /^\d{4}$/);
  });

  test("datas diferentes geram extrações diferentes", () => {
    assert.notDeepEqual(pickDailyDraw("2026-10-30"), pickDailyDraw("2026-10-31"));
  });

  test("formatDrawPrizes enriquece cada prêmio com posição, dezena, grupo, nome e emoji", () => {
    const formatted = formatDrawPrizes(["1201", "3495", "5600", "7822", "9050"]);
    assert.equal(formatted.length, 5);
    assert.equal(formatted[0].position, 1);
    assert.equal(formatted[0].group, 1);
    assert.equal(formatted[0].name, "Avestruz");
    assert.equal(formatted[1].group, 24);
    assert.equal(formatted[1].name, "Veado");
    assert.equal(formatted[2].group, 25);
    assert.equal(formatted[2].name, "Vaca");
  });
});

describe("isValidBetInput", () => {
  test("valida grupo (1..25) e dezena ('00'..'99')", () => {
    assert.equal(isValidBetInput("grupo_cabeca", 1), true);
    assert.equal(isValidBetInput("grupo_cabeca", 25), true);
    assert.equal(isValidBetInput("grupo_cabeca", 0), false);
    assert.equal(isValidBetInput("grupo_cabeca", 26), false);
    assert.equal(isValidBetInput("grupo_cercado", 24), true);
    assert.equal(isValidBetInput("dezena_cabeca", "00"), true);
    assert.equal(isValidBetInput("dezena_cabeca", "95"), true);
    assert.equal(isValidBetInput("dezena_cabeca", "5"), false);
    assert.equal(isValidBetInput("dezena_cabeca", "ab"), false);
    assert.equal(isValidBetInput("modo_invalido", 1), false);
  });
});

describe("resolveBichoBet", () => {
  // 1º: 1201 (grupo 1, dezena 01)
  // 2º: 3495 (grupo 24, dezena 95)
  // 3º: 5600 (grupo 25, dezena 00)
  // 4º: 7894 (grupo 24, dezena 94)
  // 5º: 9050 (grupo 13, dezena 50)
  const samplePrizes = ["1201", "3495", "5600", "7894", "9050"];

  test("grupo_cabeca só ganha se o bicho sair no 1º prêmio (paga 18x)", () => {
    const win = resolveBichoBet({ mode: "grupo_cabeca", target: 1, stake: 15 }, samplePrizes);
    assert.equal(win.outcome, "win");
    assert.equal(win.coinsWon, 15 * PAYOUTS.grupo_cabeca);
    assert.equal(win.coinsLost, 0);
    assert.deepEqual(win.matchedPrizes, [1]);

    // Saiu no 2º prêmio, mas apostou seco na cabeça → perde
    const lose = resolveBichoBet({ mode: "grupo_cabeca", target: 24, stake: 15 }, samplePrizes);
    assert.equal(lose.outcome, "lose");
    assert.equal(lose.coinsWon, 0);
    assert.equal(lose.coinsLost, 15);
    assert.deepEqual(lose.matchedPrizes, []);
  });

  test("grupo_cercado ganha se sair do 1º ao 5º prêmio e multiplica por cada aparição", () => {
    // Grupo 24 (Veado) aparece no 2º (95) e no 4º (94) → 2 acertos * 4x
    const doubleWin = resolveBichoBet({ mode: "grupo_cercado", target: 24, stake: 10 }, samplePrizes);
    assert.equal(doubleWin.outcome, "win");
    assert.equal(doubleWin.coinsWon, 10 * PAYOUTS.grupo_cercado * 2);
    assert.equal(doubleWin.coinsLost, 0);
    assert.deepEqual(doubleWin.matchedPrizes, [2, 4]);

    const lose = resolveBichoBet({ mode: "grupo_cercado", target: 5, stake: 10 }, samplePrizes);
    assert.equal(lose.outcome, "lose");
    assert.equal(lose.coinsWon, 0);
    assert.equal(lose.coinsLost, 10);
  });

  test("dezena_cabeca paga 60x quando crava os 2 últimos dígitos do 1º prêmio", () => {
    const win = resolveBichoBet({ mode: "dezena_cabeca", target: "01", stake: 30 }, samplePrizes);
    assert.equal(win.outcome, "win");
    assert.equal(win.coinsWon, 30 * PAYOUTS.dezena_cabeca);
    assert.equal(win.coinsLost, 0);
    assert.deepEqual(win.matchedPrizes, [1]);

    // Outra dezena do mesmo grupo (02 também é Avestruz, mas não é a dezena 01) → perde
    const loseSameGroup = resolveBichoBet({ mode: "dezena_cabeca", target: "02", stake: 30 }, samplePrizes);
    assert.equal(loseSameGroup.outcome, "lose");
    assert.equal(loseSameGroup.coinsLost, 30);
  });

  test("BET_AMOUNTS segue o padrão do cassino (5, 15, 30)", () => {
    assert.deepEqual(BET_AMOUNTS, { low: 5, medium: 15, high: 30 });
  });
});

describe("sortTodayWinners — desempate por quem apostou primeiro", () => {
  test("ordena por coinsWon decrescente e desempata por data crescente (quem apostou antes fica na frente)", () => {
    const winners = [
      { name: "Tardio",   coinsWon: 270, date: "2026-10-31T14:00:00.000Z" },
      { name: "Cedo",     coinsWon: 270, date: "2026-10-31T09:00:00.000Z" },
      { name: "Maior",    coinsWon: 540, date: "2026-10-31T18:00:00.000Z" },
      { name: "MeioDia",  coinsWon: 270, date: "2026-10-31T12:00:00.000Z" },
    ];
    const sorted = sortTodayWinners(winners);
    assert.deepEqual(sorted.map((w) => w.name), ["Maior", "Cedo", "MeioDia", "Tardio"]);
  });
});

