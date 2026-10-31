import assert from "node:assert/strict";

export const authAlice = { auth: { username: "alice", password: "alice" } };
export const authBob = { auth: { username: "bob", password: "bob" } };
export const authCarol = { auth: { username: "carol", password: "carol" } };
export const authDave = { auth: { username: "dave", password: "dave" } };
export const authAdmin = { auth: { username: "admin", password: "admin" } };

export const LAPTOP_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
export const MOUSE_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
export const PAPER_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

/**
 * Exécute une requête et vérifie que le code HTTP reçu correspond au code attendu.
 * Affiche clairement le code reçu en cas d'échec.
 */
export async function expectStatus(promise, expectedStatus) {
  try {
    const res = await promise;
    assert.equal(res.status, expectedStatus, `Attendu: ${expectedStatus}, Code reçu: ${res.status}`);
    return res;
  } catch (err) {
    const actual = err.status || err.response?.status || err.statusCode;
    if (actual !== undefined) {
      assert.equal(actual, expectedStatus, `Attendu: ${expectedStatus}, Code reçu: ${actual}`);
      return err.response || err;
    }
    throw err;
  }
}
