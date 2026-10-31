import { describe, it } from "node:test";
import assert from "node:assert/strict";
import cds from "@sap/cds";
import { authAlice, authBob, authCarol, expectStatus } from "./helpers.js";

const { GET, POST } = cds.test(".");

describe("Authentication, Session HMAC & Endpoint Security", () => {
  describe("1. Endpoint /me", () => {
    it("1.1 /me sans credentials renvoie 401", async () => {
      await expectStatus(GET("/me"), 401);
    });

    it("1.2 /me avec Basic Auth alice -> 200 + profil Demandeur", async () => {
      const res = await expectStatus(GET("/me", authAlice), 200);
      assert.equal(res.data.id, "alice");
      assert.equal(res.data.roleLabel, "Demandeur");
      assert.ok(res.data.roles.includes("Requester"));
    });

    it("1.3 /me avec Basic Auth bob -> 200 + profil Manager", async () => {
      const res = await expectStatus(GET("/me", authBob), 200);
      assert.equal(res.data.id, "bob");
      assert.equal(res.data.roleLabel, "Manager");
      assert.ok(res.data.roles.includes("Manager"));
    });

    it("1.4 /me avec Basic Auth carol -> 200 + profil Magasinier", async () => {
      const res = await expectStatus(GET("/me", authCarol), 200);
      assert.equal(res.data.id, "carol");
      assert.equal(res.data.roleLabel, "Magasinier");
      assert.ok(res.data.roles.includes("Warehouse"));
    });
  });

  describe("2. Endpoints /api/switch et /api/login (Session Cookie HMAC)", () => {
    it("2.1 /api/switch avec alice pose un cookie ptp_auth signé et permet d'accéder à /me", async () => {
      const switchRes = await expectStatus(POST("/api/switch", { username: "alice" }), 200);
      assert.equal(switchRes.data.ok, true);
      assert.equal(switchRes.data.user?.id, "alice");

      // Récupérer le header Set-Cookie
      const setCookie = switchRes.headers["set-cookie"];
      assert.ok(setCookie, "Le cookie Set-Cookie doit être présent");
      const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      assert.ok(cookieStr.includes("ptp_auth="), "Le cookie doit contenir ptp_auth");
      assert.ok(cookieStr.includes("HttpOnly"), "Le cookie doit être HttpOnly");
      assert.ok(cookieStr.includes("SameSite=Lax"), "Le cookie doit avoir SameSite=Lax");

      // Extraire le token
      const match = cookieStr.match(/ptp_auth=([^;]+)/);
      assert.ok(match, "Le token doit être extrait");
      const cookieHeader = { headers: { Cookie: `ptp_auth=${match[1]}` } };

      // Appeler /me avec ce cookie HMAC
      const meRes = await expectStatus(GET("/me", cookieHeader), 200);
      assert.equal(meRes.data.id, "alice");
      assert.equal(meRes.data.roleLabel, "Demandeur");
    });

    it("2.2 /api/switch avec utilisateur inconnu renvoie 401", async () => {
      await expectStatus(POST("/api/switch", { username: "utilisateur_inconnu_xyz" }), 401);
    });

    it("2.3 /api/switch avec username vide renvoie 400", async () => {
      await expectStatus(POST("/api/switch", { username: "" }), 400);
    });

    it("2.4 /api/login valide identifiant et mot de passe corrects", async () => {
      const loginRes = await expectStatus(POST("/api/login", { username: "bob", password: "bob" }), 200);
      assert.equal(loginRes.data.ok, true);
      assert.equal(loginRes.data.user.id, "bob");
      assert.equal(loginRes.data.user.roleLabel, "Manager");
    });

    it("2.5 /api/login avec mauvais mot de passe renvoie 401", async () => {
      await expectStatus(POST("/api/login", { username: "alice", password: "FAUX_PASSWORD" }), 401);
    });

    it("2.6 /api/login avec identifiant inconnu renvoie 401", async () => {
      await expectStatus(POST("/api/login", { username: "inconnu", password: "pwd" }), 401);
    });
  });

  describe("3. Durcissement sécurité : Cookie falsifié ou expiré", () => {
    it("3.1 /me avec cookie falsifié (signature HMAC invalide) renvoie 401", async () => {
      const fakeToken = Buffer.from("alice|9999999999|mauvaisesignature").toString("base64url");
      const fakeHdr = { headers: { Cookie: `ptp_auth=${fakeToken}` } };
      await expectStatus(GET("/me", fakeHdr), 401);
    });

    it("3.2 /me avec cookie expiré renvoie 401", async () => {
      const expiredToken = Buffer.from("alice|1|signature").toString("base64url");
      const expiredHdr = { headers: { Cookie: `ptp_auth=${expiredToken}` } };
      await expectStatus(GET("/me", expiredHdr), 401);
    });
  });

  describe("4. Endpoint /api/auth-mode & Protection Open Redirect", () => {
    it("4.1 /api/auth-mode renvoie isDev: true en profil développement", async () => {
      const res = await expectStatus(GET("/api/auth-mode"), 200);
      assert.equal(res.data.isDev, true);
      assert.equal(res.data.mode, "development");
    });

    it("4.2 Protection open redirect sur /login", async () => {
      // URL externe absolue -> redirection vers /
      const r1 = await GET("/login?returnUrl=http://evil.com", { maxRedirects: 0, validateStatus: () => true });
      assert.equal(r1.status, 302);
      assert.equal(r1.headers.location, "/");

      // Double-slash protocol-relative -> redirection vers /
      const r2 = await GET("/login?returnUrl=//evil.com", { maxRedirects: 0, validateStatus: () => true });
      assert.equal(r2.status, 302);
      assert.equal(r2.headers.location, "/");

      // URL interne sûre -> conservée
      const r3 = await GET("/login?returnUrl=/purchase-requests/webapp/index.html", {
        maxRedirects: 0,
        validateStatus: () => true
      });
      assert.equal(r3.status, 302);
      assert.equal(r3.headers.location, "/purchase-requests/webapp/index.html");
    });
  });
});
