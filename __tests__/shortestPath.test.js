jest.mock("neo4j-driver", () => {
  const mockSession = {
    executeRead: jest.fn(),
    close: jest.fn(),
  };

  const mockDriver = {
    session: jest.fn(() => mockSession),
    verifyAuthentication: Promise.resolve(),
    close: jest.fn().mockResolvedValue(undefined),
  };

  return {
    driver: jest.fn(() => mockDriver),
    auth: {
      basic: jest.fn((user, pass) => ({ user, pass })),
    },
  };
});

describe("GET /paths/shortest/:targetNodeId", () => {
  let readShortestPath;
  let mockSession;
  let req;
  let res;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    const neo4j = require("neo4j-driver");
    const mockDriver = neo4j.driver();
    mockSession = mockDriver.session();

    const service = require("../services/service");
    readShortestPath = service.readShortestPath;

    req = {
      params: {
        startNodeId: "20c37849-697e-4121-b048-f81a0c47aebd",
        targetNodeId: "skill-42",
      },
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
  });

  test("returns the shortest-path nodes and links from entry node E", async () => {
    const graphNodes = [
      { uuid: "E", name: "Entry", type: "skill" },
      { uuid: "skill-10", name: "Skill 10", type: "skill" },
      { uuid: "skill-42", name: "Skill 42", type: "skill" },
      { uuid: "skill-99", name: "Skill 99", type: "skill" },
      { uuid: "skill-100", name: "Skill 100", type: "skill" },
    ];
    const graphLinks = [
      {
        uuid: "edge-1",
        source: "E",
        target: "skill-10",
      },
      {
        uuid: "edge-2",
        source: "E",
        target: "skill-42",
      },
      {
        uuid: "edge-3",
        source: "skill-10",
        target: "skill-42",
      },
      {
        uuid: "edge-4",
        source: "E",
        target: "skill-99",
      },
      {
        uuid: "edge-5",
        source: "skill-99",
        target: "skill-100",
      },
    ];
    const expectedPathNodes = [graphNodes[0], graphNodes[2]];
    const expectedPathLinks = [graphLinks[1]];
    const pathNodes = expectedPathNodes;
    const pathLinks = expectedPathLinks;

    mockSession.executeRead.mockImplementation(async (txnCallback) => {
      const tx = {
        run: jest.fn().mockResolvedValueOnce({
          records: [
            {
              get: (field) => {
                if (field === "distinctNodes") {
                  return pathNodes;
                }

                if (field === "distinctLinks") {
                  return pathLinks;
                }

                return null;
              },
            },
          ],
        }),
      };

      return txnCallback(tx);
    });

    await readShortestPath(req, res);

    expect(mockSession.executeRead).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({
      nodes: expectedPathNodes,
      links: expectedPathLinks,
    });
    expect(mockSession.close).toHaveBeenCalledTimes(1);
  });

  test("returns 404 when no shortest path exists", async () => {
    mockSession.executeRead.mockImplementation(async (txnCallback) => {
      const tx = {
        run: jest.fn().mockResolvedValueOnce({ records: [] }),
      };

      return txnCallback(tx);
    });

    await readShortestPath(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "No shortest path found" });
  });
});
