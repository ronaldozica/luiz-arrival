const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { WORDS, WORD_LENGTH, MAX_ATTEMPTS, pickDailyWord, evaluateGuess, isValidGuessFormat } = require("../../api/lib/termo-daily");

describe("WORDS", () => {
  test("todas as palavras têm exatamente WORD_LENGTH letras", () => {
    for (const w of WORDS) assert.equal(w.length, WORD_LENGTH, `"${w}" não tem ${WORD_LENGTH} letras`);
  });

  test("todas as palavras são maiúsculas, só A-Z (sem acento/cedilha)", () => {
    for (const w of WORDS) assert.match(w, /^[A-Z]+$/, `"${w}" tem caractere fora de A-Z`);
  });

  test("sem palavras duplicadas", () => {
    const set = new Set(WORDS);
    assert.equal(set.size, WORDS.length);
  });
});

describe("pickDailyWord", () => {
  test("é determinística — mesma data sempre dá a mesma palavra", () => {
    assert.equal(pickDailyWord("2026-07-26"), pickDailyWord("2026-07-26"));
  });

  test("datas diferentes tendem a dar palavras diferentes (não é sempre a mesma)", () => {
    const words = new Set(["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24"].map(pickDailyWord));
    assert.ok(words.size > 1, "5 dias seguidos caindo na mesma palavra seria suspeito");
  });

  test("sempre retorna uma palavra da lista", () => {
    for (const d of ["2026-01-01", "2026-06-15", "2027-12-31"]) {
      assert.ok(WORDS.includes(pickDailyWord(d)));
    }
  });
});

describe("evaluateGuess", () => {
  test("acerto total: todas as posições 'correct'", () => {
    assert.deepEqual(evaluateGuess("CARRO", "CARRO"), ["correct", "correct", "correct", "correct", "correct"]);
  });

  test("nenhuma letra em comum: tudo 'absent'", () => {
    assert.deepEqual(evaluateGuess("MUNDO", "PRAIA"), ["absent", "absent", "absent", "absent", "absent"]);
  });

  test("letra certa em posição errada vira 'present'", () => {
    // CARRO (C,A,R,R,O) vs ROUPA (R,O,U,P,A): nenhuma posição bate exata,
    // mas A, R (só a 1ª ocorrência) e O existem em outro lugar.
    const result = evaluateGuess("CARRO", "ROUPA");
    assert.deepEqual(result, ["absent", "present", "present", "absent", "present"]);
  });

  test("letra repetida no palpite, só uma vez na resposta: só 1 marcação não-absent", () => {
    // Palpite ROXOS (R,O,X,O,S) vs resposta ROSAS (R,O,S,A,S) — só 1 "O" na resposta
    const result = evaluateGuess("ROXOS", "ROSAS");
    assert.equal(result[0], "correct");  // R
    assert.equal(result[1], "correct");  // O (único da resposta, consumido aqui)
    assert.equal(result[2], "absent");   // X não existe
    assert.equal(result[3], "absent");   // segundo O não tem mais O sobrando pra casar
    assert.equal(result[4], "correct");  // S
  });

  test("letra repetida no palpite, duas vezes na resposta: as duas podem marcar", () => {
    // Palpite OSSOS (O,S,S,O,S) vs resposta ROSAS² — usar um caso com 2 S de verdade
    const result = evaluateGuess("PASSO", "ROSAS");
    // PASSO: P,A,S,S,O | ROSAS: R,O,S,A,S (2 S, 1 A, 1 O)
    assert.equal(result[0], "absent");   // P não existe
    assert.equal(result[1], "present");  // A existe, posição errada
    assert.equal(result[2], "correct");  // S na posição 2 bate com S da resposta
    assert.equal(result[3], "present");  // segundo S do palpite: ainda sobra 1 S não usado na resposta
    assert.equal(result[4], "present");  // O existe, posição errada
  });

  test("não sensível a caixa (case-insensitive)", () => {
    assert.deepEqual(evaluateGuess("carro", "CARRO"), ["correct", "correct", "correct", "correct", "correct"]);
  });
});

describe("isValidGuessFormat", () => {
  test("aceita exatamente WORD_LENGTH letras, maiúsculas ou minúsculas", () => {
    assert.equal(isValidGuessFormat("carro"), true);
    assert.equal(isValidGuessFormat("CARRO"), true);
  });

  test("rejeita tamanho errado", () => {
    assert.equal(isValidGuessFormat("carr"), false);
    assert.equal(isValidGuessFormat("carros"), false);
    assert.equal(isValidGuessFormat(""), false);
  });

  test("rejeita números, espaços e acentos", () => {
    assert.equal(isValidGuessFormat("carr0"), false);
    assert.equal(isValidGuessFormat("ca rr"), false);
    assert.equal(isValidGuessFormat("cárro"), false);
  });

  test("rejeita valores não-string", () => {
    assert.equal(isValidGuessFormat(undefined), false);
    assert.equal(isValidGuessFormat(null), false);
    assert.equal(isValidGuessFormat(12345), false);
  });
});

describe("MAX_ATTEMPTS", () => {
  test("é 6, igual ao Wordle clássico", () => {
    assert.equal(MAX_ATTEMPTS, 6);
  });
});
