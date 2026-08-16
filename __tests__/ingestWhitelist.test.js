const request = require("supertest");

jest.mock("../services/service", () => ({
  readUniversalTree: jest.fn(),
  readPath: jest.fn(),
  readShortestPath: jest.fn(),
  chatbotChat: jest.fn(),
  chatbotSearch: jest.fn(),
  chatbotMaterialRequest: jest.fn(),
}));

describe("POST /ingest/analyze whitelist gate", () => {
  let app;

  beforeEach(() => {
    jest.resetModules();
    app = require("../app");
  });

  test("accepts an allowed URL", async () => {
    const res = await request(app)
      .post("/ingest/analyze")
      .send({ url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("url");
    expect(res.body.url).toBe(
      "https://developer.mozilla.org/en-US/docs/Web/JavaScript",
    );
  });

  test("rejects a non-whitelisted domain", async () => {
    const res = await request(app)
      .post("/ingest/analyze")
      .send({ url: "https://example.com/forbidden-content" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error:
        "URL domain is not allowed for ingestion. Please use one of the approved learning sites.",
    });
  });

  test("rejects malformed URLs", async () => {
    const res = await request(app)
      .post("/ingest/analyze")
      .send({ url: "not-a-valid-url" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "Please provide a valid URL.",
    });
  });
});
