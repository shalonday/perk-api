var express = require("express");
var router = express.Router();
var cors = require("cors");

const neo4jService = require("../services/neo4j");

/* GET home page. */
router.get("/", function (req, res, next) {
  res.render("index", { title: "Express" });
});

router.get("/tree", cors(), neo4jService.readUniversalTree);
router.get("/search/:query", cors(), neo4jService.searchNodes);
router.get("/nodes/:idsString", cors(), neo4jService.getNodesById); //a string of UUIDs separated by ,
router.get(
  "/pathStart/:startNode/pathEnd/:endNode",
  cors(),
  neo4jService.readPath
);

router.post(
  "/tree",
  cors({ origin: "https://shalonday.github.io" }),
  neo4jService.mergeTree
);

module.exports = router;
